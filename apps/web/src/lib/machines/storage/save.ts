import type { EventPayload } from '../events.js'
import { types, setup, createAsyncLogic, matchesState } from 'xstate'

import type {
	PreparedSave,
	SaveCapabilities,
	SaveRequest,
	SaveResult,
	StageResult,
	SyncReceipt
} from '../../contracts/storage.js'

type Context = {
	request: SaveRequest | undefined
	prepared: PreparedSave | undefined
	operationId: string
	receipts: SyncReceipt[]
	result: SaveResult | undefined
	ownedIntent:
		| import('xstate').ActorInstance<
				import('xstate').Snapshot<StageResult>,
				{ type: 'SHUTDOWN' | 'CANCEL' }
		  >
		| undefined
	ownedPublish:
		| import('xstate').ActorInstance<
				import('xstate').Snapshot<StageResult>,
				{ type: 'SHUTDOWN' | 'CANCEL' }
		  >
		| undefined
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing storage resource')
	return value
}
export function createSaveRecordMachine(capability: SaveCapabilities) {
	const actors = {
		prepare: createAsyncLogic({
			run: ({ input }: { input: SaveRequest }) => capability.prepare(input)
		})
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				INTENT_DONE: types<{ actorId: string; output: StageResult }>(),
				INTENT_ERROR: types<{ actorId: string; error: unknown }>(),
				PUBLISH_DONE: types<{ actorId: string; output: StageResult }>(),
				PUBLISH_ERROR: types<{ actorId: string; error: unknown }>(),
				SHUTDOWN: types<EventPayload<{ type: 'SHUTDOWN' }, 'SHUTDOWN'>>()
			},
			input: types<SaveRequest>(),
			output: types<SaveResult>(),
			tags: types<string>(),
			children: { prepare: types<import('xstate').ActorRefFrom<(typeof actors)['prepare']>>() }
		},
		actors,
		guards: {
			stopping: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ running: { control: 'stopping' } }, value),
			scopeLost: () => !capability.isCurrent()
		}
	})

	return model.createMachine({
		id: 'save-record',
		initial: 'running',
		context: ({ input }) => ({
			request: input,
			prepared: undefined,
			operationId: input.operationId,
			receipts: [],
			result: undefined,
			ownedIntent: undefined,
			ownedPublish: undefined
		}),
		output: ({ context }) => required(context.result),
		states: {
			running: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						states: { active: { on: { SHUTDOWN: { target: 'stopping' } } }, stopping: {} }
					},
					work: {
						initial: 'admitting',
						states: {
							admitting: {
								type: 'choice',
								choice: (args) => {
									if (args.guards.stopping(args)) {
										return { target: '#save-record.interrupted' }
									}
									if (args.guards.scopeLost()) {
										return { target: '#save-record.scopeChanged' }
									}
									return { target: 'preparing' }
								}
							},
							preparing: {
								invoke: {
									id: 'prepare',
									src: 'prepare',
									input: ({ context }: { context: Context }) => required(context.request),
									onDone: (args) => {
										if (args.guards.stopping(args)) {
											return { target: '#save-record.interrupted' }
										}
										if (args.guards.scopeLost()) {
											return { target: '#save-record.scopeChanged' }
										}
										return {
											target: 'intent',
											context: { prepared: args.event.output, request: undefined }
										}
									},
									onError: (args) => {
										if (args.guards.stopping(args)) {
											return { target: '#save-record.interrupted' }
										}
										if (args.guards.scopeLost()) {
											return { target: '#save-record.scopeChanged' }
										}
										return { target: '#save-record.failed' }
									}
								}
							},
							intent: {
								initial: 'active',
								states: {
									active: {
										on: {
											SHUTDOWN: (args, enq) => {
												enq.sendTo(args.context.ownedIntent, { type: 'SHUTDOWN' })
												return { target: 'stopping' }
											}
										}
									},
									stopping: {}
								},
								entry: (args, enq) => {
									const ref = capability.intent(
										enq.spawn,
										(({ context }: { context: Context }) => ({
											attempt: {
												operationId: context.operationId,
												workspaceId: context.operationId,
												membershipId: context.operationId,
												draft: required(context.prepared)
											}
										}))(args)
									)
									enq.subscribeTo(ref, {
										done: (
											output
										):
											| ({ type: 'INTENT_DONE' } & { actorId: string; output: StageResult })
											| ({ type: 'INTENT_ERROR' } & { actorId: string; error: unknown }) => ({
											type: 'INTENT_DONE',
											actorId: ref.id,
											output
										}),
										error: (
											error
										):
											| ({ type: 'INTENT_DONE' } & { actorId: string; output: StageResult })
											| ({ type: 'INTENT_ERROR' } & { actorId: string; error: unknown }) => ({
											type: 'INTENT_ERROR',
											actorId: ref.id,
											error
										})
									})
									return { context: { ownedIntent: ref } }
								},
								exit: ({ context }, enq) => {
									enq.stop(context.ownedIntent)
									return { context: { ownedIntent: undefined } }
								},
								on: {
									INTENT_DONE: (args) => {
										const { context, event } = args
										if (!event.output || event.output.settlement.kind === 'unresolved') {
											return { target: '#save-record.unknown' }
										}
										if (args.guards.stopping(args)) {
											return { target: '#save-record.interrupted' }
										}
										if (args.guards.scopeLost()) {
											return { target: '#save-record.scopeChanged' }
										}
										if (event.output?.outcome === 'succeeded') {
											return {
												target: 'publish',
												context: {
													receipts:
														event.output?.settlement.kind === 'locallyPersisted'
															? [...context.receipts, event.output.settlement.workspace]
															: context.receipts
												}
											}
										}
										if (event.output?.outcome === 'blocked') {
											return { target: '#save-record.blocked' }
										}
										if (event.output?.outcome === 'closed') {
											return { target: '#save-record.interrupted' }
										}
										return { target: '#save-record.failed' }
									},
									INTENT_ERROR: { target: '#save-record.unknown' }
								}
							},
							publish: {
								initial: 'active',
								states: {
									active: {
										on: {
											SHUTDOWN: (args, enq) => {
												enq.sendTo(args.context.ownedPublish, { type: 'SHUTDOWN' })
												return { target: 'stopping' }
											}
										}
									},
									stopping: {}
								},
								entry: (args, enq) => {
									const ref = capability.publish(
										enq.spawn,
										(({ context }: { context: Context }) => ({
											attempt: {
												operationId: context.operationId,
												workspaceId: context.operationId,
												membershipId: context.operationId,
												draft: required(context.prepared)
											}
										}))(args)
									)
									enq.subscribeTo(ref, {
										done: (
											output
										):
											| ({ type: 'PUBLISH_DONE' } & { actorId: string; output: StageResult })
											| ({ type: 'PUBLISH_ERROR' } & { actorId: string; error: unknown }) => ({
											type: 'PUBLISH_DONE',
											actorId: ref.id,
											output
										}),
										error: (
											error
										):
											| ({ type: 'PUBLISH_DONE' } & { actorId: string; output: StageResult })
											| ({ type: 'PUBLISH_ERROR' } & { actorId: string; error: unknown }) => ({
											type: 'PUBLISH_ERROR',
											actorId: ref.id,
											error
										})
									})
									return { context: { ownedPublish: ref } }
								},
								exit: ({ context }, enq) => {
									enq.stop(context.ownedPublish)
									return { context: { ownedPublish: undefined } }
								},
								on: {
									PUBLISH_DONE: (args) => {
										const { context, event } = args
										if (!event.output || event.output.settlement.kind === 'unresolved') {
											return { target: '#save-record.unknown' }
										}
										if (args.guards.stopping(args)) {
											return { target: '#save-record.interrupted' }
										}
										if (args.guards.scopeLost()) {
											return { target: '#save-record.scopeChanged' }
										}
										if (event.output?.outcome === 'succeeded') {
											return {
												target: '#save-record.saved',
												context: {
													receipts:
														event.output?.settlement.kind === 'locallyPersisted'
															? [...context.receipts, event.output.settlement.workspace]
															: context.receipts
												}
											}
										}
										if (event.output?.outcome === 'blocked') {
											return { target: '#save-record.blocked' }
										}
										if (event.output?.outcome === 'closed') {
											return { target: '#save-record.interrupted' }
										}
										return { target: '#save-record.failed' }
									},
									PUBLISH_ERROR: { target: '#save-record.unknown' }
								}
							}
						}
					}
				}
			},
			saved: {
				type: 'final',
				entry: (args) => {
					const { context } = args
					return {
						context: {
							result: {
								kind: 'saved',
								operationId: context.operationId,
								receipts: context.receipts
							},
							request: undefined,
							prepared: undefined,
							receipts: []
						}
					}
				}
			},
			unknown: {
				type: 'final',
				entry: (args) => {
					return {
						context: {
							result: { kind: 'unknown', operationId: args.context.operationId },
							request: undefined,
							prepared: undefined,
							receipts: []
						}
					}
				}
			},
			interrupted: {
				type: 'final',
				entry: (args) => {
					return {
						context: {
							result: { kind: 'interrupted', operationId: args.context.operationId },
							request: undefined,
							prepared: undefined,
							receipts: []
						}
					}
				}
			},
			scopeChanged: {
				type: 'final',
				entry: (args) => {
					return {
						context: {
							result: { kind: 'scopeChanged', operationId: args.context.operationId },
							request: undefined,
							prepared: undefined,
							receipts: []
						}
					}
				}
			},
			blocked: {
				type: 'final',
				entry: (args) => {
					return {
						context: {
							result: { kind: 'blocked', operationId: args.context.operationId },
							request: undefined,
							prepared: undefined,
							receipts: []
						}
					}
				}
			},
			failed: {
				type: 'final',
				entry: (args) => {
					return {
						context: {
							result: { kind: 'failed', operationId: args.context.operationId },
							request: undefined,
							prepared: undefined,
							receipts: []
						}
					}
				}
			}
		}
	})
}
