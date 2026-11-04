import { assign, enqueueActions, fromPromise, setup } from 'xstate'
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
		closing: boolean
		output: CallOutput
	}
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
		{ close: undefined },
		{},
		never,
		string,
		HostCall,
		CallOutput
	>({
		actors,
		actions: {
			close: enqueueActions(({ context, self, enqueue }) => {
				enqueue.assign({ closing: true })
				context.abort?.abort()
				for (const id of ['save', 'failure'])
					if (self.getSnapshot().children[id]) enqueue.sendTo(id, { type: 'SHUTDOWN' })
			})
		}
	})
	return model.createMachine({
		id: 'article-worker-call',
		initial: 'routing',
		context: ({ input }) => ({
			call: input,
			abort: undefined,
			closing: false,
			output: { id: input.id }
		}),
		output: ({ context }) => context.output,
		on: { SHUTDOWN: { actions: 'close' } },
		states: {
			routing: {
				always: [
					{
						guard: () => !cap.isCurrent(),
						target: 'done',
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
				entry: assign({ abort: () => new AbortController() }),
				invoke: {
					src: 'network',
					input: ({ context }) => {
						const call = required(context.call)
						if (call.type !== 'CALL' || (call.method !== 'resolve' && call.method !== 'extract'))
							throw new Error('Invalid network call')
						return { call, signal: required(context.abort).signal }
					},
					onDone: {
						target: 'done',
						actions: assign({
							output: ({ context, event }) => ({
								id: context.output.id,
								...(!context.closing && cap.isCurrent() ? { reply: event.output } : {})
							})
						})
					},
					onError: {
						target: 'done',
						actions: assign({
							output: ({ context, event }) => ({
								id: context.output.id,
								...(!context.closing && cap.isCurrent() ? { error: errorCode(event.error) } : {})
							})
						})
					}
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
					onDone: {
						target: 'done',
						actions: assign({
							output: ({ context, event }) => ({
								id: context.output.id,
								...(!context.closing && cap.isCurrent() ? { reply: event.output } : {})
							})
						})
					},
					onError: {
						target: 'done',
						actions: assign({
							output: ({ context, event }) => ({
								id: context.output.id,
								...(!context.closing && cap.isCurrent() ? { error: errorCode(event.error) } : {})
							})
						})
					}
				}
			},
			saving: {
				invoke: {
					id: 'save',
					src: 'save',
					input: ({ context }) => {
						const call = required(context.call)
						if (call.type !== 'CALL' || call.method !== 'save') throw new Error('Invalid save call')
						return call.request
					},
					onDone: {
						target: 'done',
						actions: assign({
							output: ({ context, event }) => {
								const result = required<ArticleSaveResult>(event.output)
								return {
									id: context.output.id,
									...(!context.closing && cap.isCurrent()
										? {
												result,
												reply: {
													method: 'save' as const,
													result: {
														kind: result.kind,
														operationId: result.operationId,
														ready: 'ready' in result && result.ready === true
													}
												}
											}
										: {})
								}
							}
						})
					},
					onError: {
						target: 'done',
						actions: assign({
							output: ({ context, event }) => ({
								id: context.output.id,
								...(!context.closing && cap.isCurrent() ? { error: errorCode(event.error) } : {})
							})
						})
					}
				}
			},
			failing: {
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
					onDone: {
						target: 'done',
						actions: [
							({ event }) => {
								const result = required<FailureResult>(event.output)
								if (result.settlement.kind === 'locallyPersisted')
									void result.settlement.workspace.global().catch(() => {})
							},
							assign({
								output: ({ context }) => {
									const call = required(context.call)
									return {
										id: context.output.id,
										...(!context.closing && cap.isCurrent()
											? call.type === 'RETRY'
												? { retry: call.id }
												: { reply: { method: 'fail' as const } }
											: {})
									}
								}
							})
						]
					},
					onError: {
						target: 'done',
						actions: assign({
							output: ({ context, event }) => ({
								id: context.output.id,
								...(!context.closing && cap.isCurrent() ? { error: errorCode(event.error) } : {})
							})
						})
					}
				}
			},
			done: { type: 'final', entry: assign({ call: undefined, abort: undefined }) }
		}
	})
}
