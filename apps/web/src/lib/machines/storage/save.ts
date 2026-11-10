import { createOwnedOperation } from 'delightful-local-first/lifecycle/operation/workflow'
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
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing storage resource')
	return value
}
export function createSaveRecordMachine(capability: SaveCapabilities) {
	const actors = {
		prepare: createAsyncLogic({
			run: ({ input }: { input: SaveRequest }) => capability.prepare(input)
		}),
		stage: createOwnedOperation<
			Parameters<SaveCapabilities['intent']>[1],
			StageResult,
			{ type: 'SHUTDOWN' }
		>()
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				SHUTDOWN: types<EventPayload<{ type: 'SHUTDOWN' }, 'SHUTDOWN'>>()
			},
			input: types<SaveRequest>(),
			output: types<SaveResult>(),
			tags: types<string>(),
			children: {
				prepare: types<import('xstate').ActorRefFrom<(typeof actors)['prepare']>>(),
				intent: types<import('xstate').ActorRefFrom<typeof actors.stage>>(),
				publish: types<import('xstate').ActorRefFrom<typeof actors.stage>>()
			}
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
			result: undefined
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
								invoke: {
									id: 'intent',
									src: 'stage',
									input: ({ context }) => ({
										operationId: context.operationId,
										spawn: capability.intent,
										input: {
											attempt: {
												operationId: context.operationId,
												workspaceId: context.operationId,
												membershipId: context.operationId,
												draft: required(context.prepared)
											}
										}
									}),
									onDone: (args) => {
										const operation = args.event.output
										if (operation.kind === 'failed') return { target: '#save-record.unknown' }
										const output = operation.output

										const { context } = args
										if (!output || output.settlement.kind === 'unresolved') {
											return { target: '#save-record.unknown' }
										}
										if (args.guards.stopping(args)) {
											return { target: '#save-record.interrupted' }
										}
										if (args.guards.scopeLost()) {
											return { target: '#save-record.scopeChanged' }
										}
										if (output?.outcome === 'succeeded') {
											return {
												target: 'publish',
												context: {
													receipts:
														output?.settlement.kind === 'locallyPersisted'
															? [...context.receipts, output.settlement.workspace]
															: context.receipts
												}
											}
										}
										if (output?.outcome === 'blocked') {
											return { target: '#save-record.blocked' }
										}
										if (output?.outcome === 'closed') {
											return { target: '#save-record.interrupted' }
										}
										return { target: '#save-record.failed' }
									},
									onError: { target: '#save-record.unknown' }
								},
								on: {
									SHUTDOWN: (_, enq) => {
										enq.sendTo('intent', { type: 'INTERRUPT', command: { type: 'SHUTDOWN' } })
									}
								}
							},
							publish: {
								invoke: {
									id: 'publish',
									src: 'stage',
									input: ({ context }) => ({
										operationId: context.operationId,
										spawn: capability.publish,
										input: {
											attempt: {
												operationId: context.operationId,
												workspaceId: context.operationId,
												membershipId: context.operationId,
												draft: required(context.prepared)
											}
										}
									}),
									onDone: (args) => {
										const operation = args.event.output
										if (operation.kind === 'failed') return { target: '#save-record.unknown' }
										const output = operation.output

										const { context } = args
										if (!output || output.settlement.kind === 'unresolved') {
											return { target: '#save-record.unknown' }
										}
										if (args.guards.stopping(args)) {
											return { target: '#save-record.interrupted' }
										}
										if (args.guards.scopeLost()) {
											return { target: '#save-record.scopeChanged' }
										}
										if (output?.outcome === 'succeeded') {
											return {
												target: '#save-record.saved',
												context: {
													receipts:
														output?.settlement.kind === 'locallyPersisted'
															? [...context.receipts, output.settlement.workspace]
															: context.receipts
												}
											}
										}
										if (output?.outcome === 'blocked') {
											return { target: '#save-record.blocked' }
										}
										if (output?.outcome === 'closed') {
											return { target: '#save-record.interrupted' }
										}
										return { target: '#save-record.failed' }
									},
									onError: { target: '#save-record.unknown' }
								},
								on: {
									SHUTDOWN: (_, enq) => {
										enq.sendTo('publish', { type: 'INTERRUPT', command: { type: 'SHUTDOWN' } })
									}
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
