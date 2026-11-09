import { identityLogic } from '../identity.js'
import type { EventPayload } from '../events.js'
import { types, setup, createAsyncLogic, type Snapshot, matchesState } from 'xstate'

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
export type CallCapability = {
	isCurrent: () => boolean
	network: (
		call: Extract<WorkerCall, { method: 'resolve' | 'extract' }>,
		signal: AbortSignal
	) => Promise<RpcReply>
	lookup: (call: Extract<WorkerCall, { method: 'document' | 'intent' }>) => Promise<RpcReply>
	save: (
		spawn: import('../children.js').ChildSpawner,
		input: SaveArticleRequest
	) => import('xstate').ActorInstance<Snapshot<ArticleSaveResult>, { type: 'SHUTDOWN' }>
	failure: (
		spawn: import('../children.js').ChildSpawner,
		input: FailureInput
	) => import('xstate').ActorInstance<Snapshot<FailureResult>, { type: 'SHUTDOWN' | 'CANCEL' }>
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
export function createArticleWorkerCallMachine(cap: CallCapability) {
	type Context = {
		call: HostCall | undefined
		failureOperationId: string
		abort: AbortController | undefined
		output: CallOutput
		ownedSave:
			| import('xstate').ActorInstance<
					import('xstate').Snapshot<ArticleSaveResult>,
					{ type: 'SHUTDOWN' }
			  >
			| undefined
		ownedFailure:
			| import('xstate').ActorInstance<
					import('xstate').Snapshot<FailureResult>,
					{ type: 'SHUTDOWN' | 'CANCEL' }
			  >
			| undefined
	}
	const complete = (context: Context, outcome: Omit<CallOutput, 'id'>): CallOutput => ({
		id: context.output.id,
		...outcome
	})
	const actors = {
		identity: identityLogic,
		network: createAsyncLogic({
			run: ({
				input
			}: {
				input: { call: Extract<WorkerCall, { method: 'resolve' | 'extract' }>; signal: AbortSignal }
			}) => cap.network(input.call, input.signal)
		}),
		lookup: createAsyncLogic({
			run: ({ input }: { input: Extract<WorkerCall, { method: 'document' | 'intent' }> }) =>
				cap.lookup(input)
		})
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				SAVE_DONE: types<{ actorId: string; output: ArticleSaveResult }>(),
				SAVE_ERROR: types<{ actorId: string; error: unknown }>(),
				FAILURE_DONE: types<{ actorId: string; output: FailureResult }>(),
				FAILURE_ERROR: types<{ actorId: string; error: unknown }>(),
				SHUTDOWN: types<EventPayload<{ type: 'SHUTDOWN' }, 'SHUTDOWN'>>()
			},
			input: types<HostCall>(),
			output: types<CallOutput>(),
			tags: types<string>(),
			children: {
				identity: types<import('xstate').ActorRefFrom<typeof identityLogic>>(),
				network: types<import('xstate').ActorRefFrom<(typeof actors)['network']>>(),
				lookup: types<import('xstate').ActorRefFrom<(typeof actors)['lookup']>>()
			}
		},
		actors,
		guards: {
			closing: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ running: { control: 'stopping' } }, value),
			stale: () => !cap.isCurrent()
		},
		actions: {
			completeFailure: (args: { context: Context }, _params?: undefined) => ({
				context: {
					output: (({ context }) => {
						const call = required(context.call)
						return complete(
							context,
							call.type === 'RETRY' ? { retry: call.id } : { reply: { method: 'fail' } }
						)
					})(args)
				}
			})
		}
	})

	const failed = ({ context, event }: { context: Context; event: { error: unknown } }) => ({
		output: complete(context, { error: errorCode(event.error) })
	})

	return model.createMachine({
		id: 'article-worker-call',
		initial: 'running',
		context: ({ input }) => ({
			call: input,
			abort: undefined,
			output: { id: input.id },
			ownedSave: undefined,
			ownedFailure: undefined,
			failureOperationId: ''
		}),
		output: ({ context }) => context.output,
		states: {
			running: {
				type: 'parallel' as const,
				states: {
					control: {
						initial: 'active',
						states: { active: { on: { SHUTDOWN: { target: 'stopping' } } }, stopping: {} }
					},
					work: {
						initial: 'routing',
						states: {
							routing: {
								always: (args) => {
									const { context } = args
									if (!cap.isCurrent()) {
										return {
											target: '#article-worker-call.done',
											context: { output: { id: context.output.id, error: 'scopeChanged' } }
										}
									}
									if (
										context.call?.type === 'RETRY' ||
										(context.call?.type === 'CALL' && context.call.method === 'fail')
									) {
										return { target: 'identifyingFailure' }
									}
									if (context.call?.type === 'CALL' && context.call.method === 'save') {
										return { target: 'saving' }
									}
									if (
										context.call?.type === 'CALL' &&
										(context.call.method === 'resolve' || context.call.method === 'extract')
									) {
										return { target: 'network', context: { abort: new AbortController() } }
									}
									return { target: 'lookup' }
								}
							},
							network: {
								initial: 'active',
								states: {
									active: {
										on: {
											SHUTDOWN: (args, enq) => {
												enq(() => required(args.context.abort).abort())
												return { target: 'stopping' }
											}
										}
									},
									stopping: {}
								},

								invoke: {
									id: 'network',
									src: 'network',
									input: ({ context }: { context: Context }) => {
										const call = required(context.call)
										if (
											call.type !== 'CALL' ||
											(call.method !== 'resolve' && call.method !== 'extract')
										)
											throw new Error('Invalid network call')
										return { call, signal: required(context.abort).signal }
									},
									onDone: (args) => {
										const { context } = args
										if (args.guards.closing(args)) {
											return { target: '#article-worker-call.suppressed' }
										}
										if (args.guards.stale()) {
											return { target: '#article-worker-call.suppressed' }
										}
										return {
											target: '#article-worker-call.done',
											context: { output: complete(context, { reply: args.event.output }) }
										}
									},
									onError: (args) => {
										const { context, event } = args
										if (args.guards.closing(args)) {
											return { target: '#article-worker-call.suppressed' }
										}
										if (args.guards.stale()) {
											return { target: '#article-worker-call.suppressed' }
										}
										return {
											target: '#article-worker-call.done',
											context: failed({ context, event })
										}
									}
								}
							},
							lookup: {
								invoke: {
									id: 'lookup',
									src: 'lookup',
									input: ({ context }: { context: Context }) => {
										const call = required(context.call)
										if (
											call.type !== 'CALL' ||
											(call.method !== 'document' && call.method !== 'intent')
										)
											throw new Error('Invalid lookup call')
										return call
									},
									onDone: (args) => {
										const { context } = args
										if (args.guards.closing(args)) {
											return { target: '#article-worker-call.suppressed' }
										}
										if (args.guards.stale()) {
											return { target: '#article-worker-call.suppressed' }
										}
										return {
											target: '#article-worker-call.done',
											context: { output: complete(context, { reply: args.event.output }) }
										}
									},
									onError: (args) => {
										const { context, event } = args
										if (args.guards.closing(args)) {
											return { target: '#article-worker-call.suppressed' }
										}
										if (args.guards.stale()) {
											return { target: '#article-worker-call.suppressed' }
										}
										return {
											target: '#article-worker-call.done',
											context: failed({ context, event })
										}
									}
								}
							},
							saving: {
								initial: 'active',
								states: {
									active: {
										on: {
											SHUTDOWN: (args, enq) => {
												enq.sendTo(args.context.ownedSave, { type: 'SHUTDOWN' as const })
												return { target: 'stopping' }
											}
										}
									},
									stopping: {}
								},
								entry: (args, enq) => {
									const ref = cap.save(
										enq.spawn,
										(({ context }: { context: Context }) => {
											const call = required(context.call)
											if (call.type !== 'CALL' || call.method !== 'save')
												throw new Error('Invalid save call')
											return call.request
										})(args)
									)
									enq.subscribeTo(ref, {
										done: (
											output
										):
											| ({ type: 'SAVE_DONE' } & { actorId: string; output: ArticleSaveResult })
											| ({ type: 'SAVE_ERROR' } & { actorId: string; error: unknown }) => ({
											type: 'SAVE_DONE',
											actorId: ref.id,
											output
										}),
										error: (
											error
										):
											| ({ type: 'SAVE_DONE' } & { actorId: string; output: ArticleSaveResult })
											| ({ type: 'SAVE_ERROR' } & { actorId: string; error: unknown }) => ({
											type: 'SAVE_ERROR',
											actorId: ref.id,
											error
										})
									})
									return { context: { ownedSave: ref } }
								},
								exit: ({ context }, enq) => {
									enq.stop(context.ownedSave)
									return { context: { ownedSave: undefined } }
								},
								on: {
									SAVE_DONE: (args) => {
										if (args.guards.closing(args)) {
											return { target: '#article-worker-call.suppressed' }
										}
										if (args.guards.stale()) {
											return { target: '#article-worker-call.suppressed' }
										}
										return {
											target: '#article-worker-call.done',
											context: {
												output: (({ context, event }) => {
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
												})(args)
											}
										}
									},
									SAVE_ERROR: (args) => {
										const { context, event } = args
										if (args.guards.closing(args)) {
											return { target: '#article-worker-call.suppressed' }
										}
										if (args.guards.stale()) {
											return { target: '#article-worker-call.suppressed' }
										}
										return {
											target: '#article-worker-call.done',
											context: failed({ context, event })
										}
									}
								}
							},
							identifyingFailure: {
								invoke: {
									id: 'identity',
									src: 'identity',
									onDone: (args) => {
										if (args.guards.closing(args) || args.guards.stale())
											return { target: '#article-worker-call.suppressed' }
										return { target: 'failing', context: { failureOperationId: args.event.output } }
									},
									onError: { target: '#article-worker-call.suppressed' }
								}
							},
							failing: {
								initial: 'active',
								states: {
									active: {
										on: {
											SHUTDOWN: (args, enq) => {
												enq.sendTo(args.context.ownedFailure, { type: 'SHUTDOWN' as const })
												return { target: 'stopping' }
											}
										}
									},
									stopping: {}
								},
								entry: (args, enq) => {
									const ref = cap.failure(
										enq.spawn,
										(({ context }: { context: Context }) => {
											const call = required(context.call)
											if (call.type !== 'RETRY' && call.method !== 'fail')
												throw new Error('Invalid failure call')
											const id = call.type === 'RETRY' ? call.id : call.articleId
											return {
												attempt: {
													operationId: context.failureOperationId,
													workspaceId: id,
													membershipId: id,
													draft: { id, code: call.type === 'RETRY' ? null : call.code }
												}
											}
										})(args)
									)
									enq.subscribeTo(ref, {
										done: (
											output
										):
											| ({ type: 'FAILURE_DONE' } & { actorId: string; output: FailureResult })
											| ({ type: 'FAILURE_ERROR' } & { actorId: string; error: unknown }) => ({
											type: 'FAILURE_DONE',
											actorId: ref.id,
											output
										}),
										error: (
											error
										):
											| ({ type: 'FAILURE_DONE' } & { actorId: string; output: FailureResult })
											| ({ type: 'FAILURE_ERROR' } & { actorId: string; error: unknown }) => ({
											type: 'FAILURE_ERROR',
											actorId: ref.id,
											error
										})
									})
									return { context: { ownedFailure: ref } }
								},
								exit: ({ context }, enq) => {
									enq.stop(context.ownedFailure)
									return { context: { ownedFailure: undefined } }
								},
								on: {
									FAILURE_DONE: (args, enq) => {
										let pendingContext = {}

										const { event } = args
										if (args.guards.closing(args)) {
											return { context: pendingContext, target: '#article-worker-call.suppressed' }
										}
										if (args.guards.stale()) {
											return { context: pendingContext, target: '#article-worker-call.suppressed' }
										}
										if (
											required<FailureResult>(event.output).settlement.kind === 'locallyPersisted'
										) {
											enq(({ event }) => {
												const settlement = required<FailureResult>(event.output).settlement
												if (settlement.kind !== 'locallyPersisted')
													throw new Error('Expected local failure receipt')
												void settlement.workspace.global().catch(() => {})
											}, args)
											pendingContext = {
												...pendingContext,
												...(() => args.actions.completeFailure(args).context)()
											}
											return { context: pendingContext, target: '#article-worker-call.done' }
										}
										pendingContext = {
											...pendingContext,
											...(() => args.actions.completeFailure(args).context)()
										}
										return { context: pendingContext, target: '#article-worker-call.done' }
									},
									FAILURE_ERROR: (args) => {
										const { context, event } = args
										if (args.guards.closing(args)) {
											return { target: '#article-worker-call.suppressed' }
										}
										if (args.guards.stale()) {
											return { target: '#article-worker-call.suppressed' }
										}
										return {
											target: '#article-worker-call.done',
											context: failed({ context, event })
										}
									}
								}
							}
						}
					}
				}
			},
			suppressed: {
				type: 'final' as const,
				entry: (args) => {
					return {
						context: { output: { id: args.context.output.id }, call: undefined, abort: undefined }
					}
				}
			},
			done: {
				type: 'final' as const,
				entry: () => {
					return { context: { call: undefined, abort: undefined } }
				}
			}
		}
	})
}
