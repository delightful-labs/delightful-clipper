import { identityLogic } from '../identity.js'
import type { EventPayload } from '../events.js'
import {
	types,
	setup,
	createAsyncLogic,
	createCallbackLogic,
	type Snapshot,
	matchesState
} from 'xstate'

import type { WorkspaceCreationResult } from 'delightful-local-first/workspace/creation/contracts'
import type { ArticleSaveResult, SaveArticleRequest } from '../../contracts/articles.js'
import type { RpcReply, WorkerCall } from '../../contracts/article-worker.js'
import type { SyncReceipt } from '../../contracts/storage.js'
export type FailureDraft = { id: string; code: string | null }
export type FailureInput = {
	attempt: { operationId: string; workspaceId: string; membershipId: string; draft: FailureDraft }
}
export type FailureResult = WorkspaceCreationResult<FailureDraft, SyncReceipt>
type SaveReport =
	| { type: 'SAVE_DONE'; actorId: string; output: ArticleSaveResult }
	| { type: 'SAVE_ERROR'; actorId: string; error: unknown }
type FailureReport =
	| { type: 'FAILURE_DONE'; actorId: string; output: FailureResult }
	| { type: 'FAILURE_ERROR'; actorId: string; error: unknown }
type NetworkCall = Extract<WorkerCall, { method: 'resolve' | 'extract' }>
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
	function saveOutput(context: Context, result: ArticleSaveResult): CallOutput {
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

	const actors = {
		identity: identityLogic,
		network: createCallbackLogic<{ type: 'ABORT' }, NetworkCall>(({ input, receive, sendBack }) => {
			const controller = new AbortController()
			let settled = false,
				disposed = false
			const abort = () => {
				if (!settled && !controller.signal.aborted) controller.abort()
			}
			const failed = (error: unknown) => {
				settled = true
				if (!disposed) sendBack({ type: 'NETWORK_ERROR', error })
			}
			receive(abort)
			try {
				void cap.network(input, controller.signal).then((output) => {
					settled = true
					if (!disposed) sendBack({ type: 'NETWORK_DONE', output })
				}, failed)
			} catch (error) {
				failed(error)
			}
			return () => {
				disposed = true
				abort()
			}
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
				NETWORK_DONE: types<{ output: RpcReply }>(),
				NETWORK_ERROR: types<{ error: unknown }>(),
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
		states: {
			running: {
				id: 'article-worker-call.running',
				states: {
					control: {
						id: 'article-worker-call.running.control',
						states: {
							active: { id: 'article-worker-call.running.control.active' },
							stopping: { id: 'article-worker-call.running.control.stopping' }
						}
					},
					work: {
						id: 'article-worker-call.running.work',
						states: {
							routing: { id: 'article-worker-call.running.work.routing' },
							network: {
								id: 'article-worker-call.running.work.network',
								schemas: { input: types<NetworkCall>() },
								states: {
									active: { id: 'article-worker-call.running.work.network.active' },
									stopping: { id: 'article-worker-call.running.work.network.stopping' }
								}
							},
							lookup: { id: 'article-worker-call.running.work.lookup' },
							saving: {
								id: 'article-worker-call.running.work.saving',
								schemas: { input: types<SaveArticleRequest>() },
								states: {
									active: { id: 'article-worker-call.running.work.saving.active' },
									stopping: { id: 'article-worker-call.running.work.saving.stopping' }
								}
							},
							identifyingFailure: { id: 'article-worker-call.running.work.identifyingFailure' },
							failing: {
								id: 'article-worker-call.running.work.failing',
								states: {
									active: { id: 'article-worker-call.running.work.failing.active' },
									stopping: { id: 'article-worker-call.running.work.failing.stopping' }
								}
							}
						}
					}
				}
			},
			suppressed: { id: 'article-worker-call.suppressed' },
			done: { id: 'article-worker-call.done' }
		},
		actors,
		guards: {
			closing: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ running: { control: 'stopping' } }, value),
			stale: () => !cap.isCurrent()
		},
		actions: {
			completeFailure: ({ context }: { context: Context }) => {
				const call = required(context.call)
				return {
					context: {
						output: complete(
							context,
							call.type === 'RETRY' ? { retry: call.id } : { reply: { method: 'fail' } }
						)
					}
				}
			}
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
			output: { id: input.id },
			ownedSave: undefined,
			ownedFailure: undefined,
			failureOperationId: ''
		}),
		output: ({ context }) => context.output,
		states: {
			running: {
				type: 'parallel',
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
										return { target: 'saving', input: context.call.request }
									}
									if (
										context.call?.type === 'CALL' &&
										(context.call.method === 'resolve' || context.call.method === 'extract')
									) {
										return { target: 'network', input: context.call }
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
												enq.sendTo('network', { type: 'ABORT' })
												return { target: 'stopping' }
											}
										}
									},
									stopping: {}
								},

								invoke: {
									id: 'network',
									src: 'network',
									input: ({ input }) => input,
									onError: (args) => {
										if (args.guards.closing(args) || args.guards.stale())
											return { target: '#article-worker-call.suppressed' }
										return { target: '#article-worker-call.done', context: failed(args) }
									}
								},
								on: {
									NETWORK_DONE: (args) => {
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
									NETWORK_ERROR: (args) => {
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
												enq.sendTo(args.context.ownedSave, { type: 'SHUTDOWN' })
												return { target: 'stopping' }
											}
										}
									},
									stopping: {}
								},
								entry: ({ input }, enq) => {
									const ref = cap.save(enq.spawn, input)
									enq.subscribeTo(ref, {
										done: (output): SaveReport => ({ type: 'SAVE_DONE', actorId: ref.id, output }),
										error: (error): SaveReport => ({ type: 'SAVE_ERROR', actorId: ref.id, error })
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
												output: saveOutput(args.context, args.event.output)
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
												enq.sendTo(args.context.ownedFailure, { type: 'SHUTDOWN' })
												return { target: 'stopping' }
											}
										}
									},
									stopping: {}
								},
								entry: ({ context }, enq) => {
									const call = required(context.call)
									if (call.type !== 'RETRY' && call.method !== 'fail')
										throw new Error('Invalid failure call')
									const id = call.type === 'RETRY' ? call.id : call.articleId
									const ref = cap.failure(enq.spawn, {
										attempt: {
											operationId: context.failureOperationId,
											workspaceId: id,
											membershipId: id,
											draft: { id, code: call.type === 'RETRY' ? null : call.code }
										}
									})
									enq.subscribeTo(ref, {
										done: (output): FailureReport => ({
											type: 'FAILURE_DONE',
											actorId: ref.id,
											output
										}),
										error: (error): FailureReport => ({
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
										if (args.guards.closing(args) || args.guards.stale())
											return { target: '#article-worker-call.suppressed' }
										const settlement = args.event.output.settlement
										if (settlement.kind === 'locallyPersisted')
											enq(() => {
												void settlement.workspace.global().catch(() => {})
											})
										return {
											target: '#article-worker-call.done',
											context: args.actions.completeFailure(args).context
										}
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
				type: 'final',
				entry: (args) => {
					return {
						context: { output: { id: args.context.output.id }, call: undefined }
					}
				}
			},
			done: {
				type: 'final',
				entry: () => {
					return { context: { call: undefined } }
				}
			}
		}
	})
}
