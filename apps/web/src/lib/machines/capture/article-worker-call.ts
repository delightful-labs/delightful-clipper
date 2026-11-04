import { assign, fromPromise, setup, stateIn, sendTo } from 'xstate'
import type { ActorLogic, Snapshot } from 'xstate'
import type { WorkspaceCreationResult } from 'delightful-local-first/workspace/creation/contracts'
import type { ArticleSaveResult, SaveArticleRequest } from '../../contracts/articles.js'
import type { RpcReply, WorkerCall } from '../../contracts/article-worker.js'
import type { SyncReceipt } from '../../contracts/storage.js'
export type FailureDraft = { id: string; code: string | null }
export type FailureInput = {
	attempt: { operationId: string; workspaceId: string; membershipId: string; draft: FailureDraft }
}
export type FailureResult = WorkspaceCreationResult<FailureDraft, SyncReceipt>
export type HostCall = WorkerCall | { type: 'RETRY'; id: string }
export type CallOutput = {
	id: string
	reply?: RpcReply
	result?: ArticleSaveResult
	error?: string
	retry?: string
}
export type CallCapability<
	S extends Snapshot<ArticleSaveResult>,
	F extends Snapshot<FailureResult>
> = {
	isCurrent: () => boolean
	network: (
		call: Extract<WorkerCall, { method: 'resolve' | 'extract' }>,
		signal: AbortSignal
	) => Promise<RpcReply>
	lookup: (call: Extract<WorkerCall, { method: 'document' | 'intent' }>) => Promise<RpcReply>
	save: ActorLogic<S, { type: 'SHUTDOWN' }, SaveArticleRequest>
	failure: ActorLogic<F, { type: 'SHUTDOWN' | 'CANCEL' }, FailureInput>
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing worker call')
	return value
}
function errorCode(error: unknown) {
	return error instanceof Error &&
		[
			'scopeChanged',
			'sessionUnavailable',
			'rateLimited',
			'sourceTooLarge',
			'invalidResponse',
			'captureFailed'
		].includes(error.message)
		? error.message
		: 'networkUnavailable'
}
export function createArticleWorkerCallMachine<
	S extends Snapshot<ArticleSaveResult>,
	F extends Snapshot<FailureResult>
>(cap: CallCapability<S, F>) {
	type Context = {
		call: HostCall | undefined
		abort: AbortController | undefined
		output: CallOutput
	}
	const complete = (context: Context, outcome: Omit<CallOutput, 'id'>): CallOutput => ({
		id: context.output.id,
		...outcome
	})
	const actors = {
		network: fromPromise(
			({
				input
			}: {
				input: { call: Extract<WorkerCall, { method: 'resolve' | 'extract' }>; signal: AbortSignal }
			}) => cap.network(input.call, input.signal)
		),
		lookup: fromPromise(
			({ input }: { input: Extract<WorkerCall, { method: 'document' | 'intent' }> }) =>
				cap.lookup(input)
		),
		save: cap.save,
		failure: cap.failure
	}
	const model = setup<
		Context,
		{ type: 'SHUTDOWN' },
		typeof actors,
		{},
		{ completeFailure: undefined },
		{ closing: undefined; stale: undefined },
		never,
		string,
		HostCall,
		CallOutput
	>({
		actors,
		guards: {
			closing: stateIn({ running: { control: 'stopping' } }),
			stale: () => !cap.isCurrent()
		},
		actions: {
			completeFailure: assign({
				output: ({ context }) => {
					const call = required(context.call)
					return complete(
						context,
						call.type === 'RETRY' ? { retry: call.id } : { reply: { method: 'fail' } }
					)
				}
			})
		}
	})
	const suppress = [
		{ guard: 'closing' as const, target: '#article-worker-call.suppressed' },
		{ guard: 'stale' as const, target: '#article-worker-call.suppressed' }
	]
	const failed = ({ context, event }: { context: Context; event: { error: unknown } }) => ({
		output: complete(context, { error: errorCode(event.error) })
	})
	const work = model.createStateConfig({
		initial: 'routing',
		states: {
			routing: {
				always: [
					{
						guard: () => !cap.isCurrent(),
						target: '#article-worker-call.done',
						actions: assign({
							output: ({ context }) => ({ id: context.output.id, error: 'scopeChanged' })
						})
					},
					{
						guard: ({ context }) =>
							context.call?.type === 'RETRY' ||
							(context.call?.type === 'CALL' && context.call.method === 'fail'),
						target: 'failing'
					},
					{
						guard: ({ context }) => context.call?.type === 'CALL' && context.call.method === 'save',
						target: 'saving'
					},
					{
						guard: ({ context }) =>
							context.call?.type === 'CALL' &&
							(context.call.method === 'resolve' || context.call.method === 'extract'),
						target: 'network'
					},
					{ target: 'lookup' }
				]
			},
			network: {
				initial: 'active',
				states: {
					active: {
						on: {
							SHUTDOWN: {
								target: 'stopping',
								actions: ({ context }) => required(context.abort).abort()
							}
						}
					},
					stopping: {}
				},
				entry: assign({ abort: () => new AbortController() }),
				invoke: {
					src: 'network',
					input: ({ context }) => {
						const call = required(context.call)
						if (call.type !== 'CALL' || (call.method !== 'resolve' && call.method !== 'extract'))
							throw new Error('Invalid network call')
						return { call, signal: required(context.abort).signal }
					},
					onDone: [
						...suppress,
						{
							target: '#article-worker-call.done',
							actions: assign({
								output: ({ context, event }) => complete(context, { reply: event.output })
							})
						}
					],
					onError: [
						...suppress,
						{
							target: '#article-worker-call.done',
							actions: assign(({ context, event }) => failed({ context, event }))
						}
					]
				}
			},
			lookup: {
				invoke: {
					src: 'lookup',
					input: ({ context }) => {
						const call = required(context.call)
						if (call.type !== 'CALL' || (call.method !== 'document' && call.method !== 'intent'))
							throw new Error('Invalid lookup call')
						return call
					},
					onDone: [
						...suppress,
						{
							target: '#article-worker-call.done',
							actions: assign({
								output: ({ context, event }) => complete(context, { reply: event.output })
							})
						}
					],
					onError: [
						...suppress,
						{
							target: '#article-worker-call.done',
							actions: assign(({ context, event }) => failed({ context, event }))
						}
					]
				}
			},
			saving: {
				initial: 'active',
				states: {
					active: {
						on: {
							SHUTDOWN: {
								target: 'stopping',
								actions: sendTo('save', { type: 'SHUTDOWN' })
							}
						}
					},
					stopping: {}
				},
				invoke: {
					id: 'save',
					src: 'save',
					input: ({ context }) => {
						const call = required(context.call)
						if (call.type !== 'CALL' || call.method !== 'save') throw new Error('Invalid save call')
						return call.request
					},
					onDone: [
						...suppress,
						{
							target: '#article-worker-call.done',
							actions: assign({
								output: ({ context, event }) => {
									const result = required<ArticleSaveResult>(event.output)
									return complete(context, {
										result,
										reply: {
											method: 'save',
											result: {
												kind: result.kind,
												operationId: result.operationId,
												ready: 'ready' in result && result.ready === true
											}
										}
									})
								}
							})
						}
					],
					onError: [
						...suppress,
						{
							target: '#article-worker-call.done',
							actions: assign(({ context, event }) => failed({ context, event }))
						}
					]
				}
			},
			failing: {
				initial: 'active',
				states: {
					active: {
						on: {
							SHUTDOWN: {
								target: 'stopping',
								actions: sendTo('failure', { type: 'SHUTDOWN' })
							}
						}
					},
					stopping: {}
				},
				invoke: {
					id: 'failure',
					src: 'failure',
					input: ({ context }) => {
						const call = required(context.call)
						if (call.type !== 'RETRY' && call.method !== 'fail')
							throw new Error('Invalid failure call')
						const id = call.type === 'RETRY' ? call.id : call.articleId
						return {
							attempt: {
								operationId: crypto.randomUUID(),
								workspaceId: id,
								membershipId: id,
								draft: { id, code: call.type === 'RETRY' ? null : call.code }
							}
						}
					},
					onDone: [
						...suppress,
						{
							guard: ({ event }) =>
								required<FailureResult>(event.output).settlement.kind === 'locallyPersisted',
							target: '#article-worker-call.done',
							actions: [
								({ event }) => {
									const settlement = required<FailureResult>(event.output).settlement
									if (settlement.kind !== 'locallyPersisted')
										throw new Error('Expected local failure receipt')
									void settlement.workspace.global().catch(() => {})
								},
								'completeFailure'
							]
						},
						{ target: '#article-worker-call.done', actions: 'completeFailure' }
					],
					onError: [
						...suppress,
						{
							target: '#article-worker-call.done',
							actions: assign(({ context, event }) => failed({ context, event }))
						}
					]
				}
			}
		}
	})
	return model.createMachine({
		id: 'article-worker-call',
		initial: 'running',
		context: ({ input }) => ({
			call: input,
			abort: undefined,
			output: { id: input.id }
		}),
		output: ({ context }) => context.output,
		states: {
			running: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						states: { active: { on: { SHUTDOWN: 'stopping' } }, stopping: {} }
					},
					work
				}
			},
			suppressed: {
				type: 'final',
				entry: assign({
					output: ({ context }) => ({ id: context.output.id }),
					call: undefined,
					abort: undefined
				})
			},
			done: { type: 'final', entry: assign({ call: undefined, abort: undefined }) }
		}
	})
}
