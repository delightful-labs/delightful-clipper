import { createOwnedOperation } from 'delightful-local-first/lifecycle/operation/workflow'
import { identityLogic } from '../identity.js'
import type { EventPayload } from '../events.js'
import { types, setup, createAsyncLogic, matchesState, type Snapshot } from 'xstate'

import type { WorkspaceCreationResult } from 'delightful-local-first/workspace/creation/contracts'
import type { TagOperation } from '../../capture/tags.js'
import type { OrganizationRequest, OrganizationOperation } from '../../capture/organization.js'
import type { SaveResult, SyncReceipt } from '../../contracts/storage.js'
export type OrganizationHistory = OrganizationOperation | TagOperation
export type OrganizationDraft = OrganizationRequest & { operations: OrganizationHistory[] }
export type OrganizationStageResult = WorkspaceCreationResult<OrganizationDraft, SyncReceipt>
export type OrganizationStage = (
	spawn: import('../children.js').ChildSpawner,
	input: {
		attempt: {
			operationId: string
			workspaceId: string
			membershipId: string
			draft: OrganizationDraft
		}
	}
) => import('xstate').ActorInstance<
	Snapshot<OrganizationStageResult>,
	{ type: 'SHUTDOWN' | 'CANCEL' }
>
function required<T>(v: T | undefined): T {
	if (v === undefined) throw new Error('Missing organization resource')
	return v
}
export function createOrganizationMachine(
	stage: OrganizationStage,
	isCurrent: () => boolean,
	observe: (request: OrganizationRequest) => Promise<OrganizationHistory[]> = async () => [],
	observeTags: (request: OrganizationRequest) => Promise<OrganizationHistory[]> = async () => []
) {
	const history = createAsyncLogic({
		run: ({ input }: { input: OrganizationRequest }) => observe(input)
	})
	const tagHistory = createAsyncLogic({
		run: ({ input }: { input: OrganizationRequest }) => observeTags(input)
	})
	const operation = createOwnedOperation<
		Parameters<OrganizationStage>[1],
		OrganizationStageResult,
		{ type: 'SHUTDOWN' }
	>()
	const model = setup({
		schemas: {
			context: types<{
				request: OrganizationRequest | undefined
				operations: OrganizationHistory[]
				operationId: string
				result: SaveResult | undefined
			}>(),
			events: {
				SHUTDOWN: types<EventPayload<{ type: 'SHUTDOWN' }, 'SHUTDOWN'>>()
			},
			input: types<OrganizationRequest>(),
			output: types<SaveResult>(),
			tags: types<string>(),
			children: {
				identity: types<import('xstate').ActorRefFrom<typeof identityLogic>>(),
				history: types<import('xstate').ActorRefFrom<typeof history>>(),
				tagHistory: types<import('xstate').ActorRefFrom<typeof tagHistory>>(),
				stage: types<import('xstate').ActorRefFrom<typeof operation>>()
			}
		},
		actors: { history, tagHistory, identity: identityLogic, operation },
		guards: {
			tagRequest: ({
				context
			}: {
				context: {
					request: OrganizationRequest | undefined
					operations: OrganizationHistory[]
					operationId: string
					result: SaveResult | undefined
				}
			}) => context.request?.field === 'tag',
			stale: () => !isCurrent(),
			stopping: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ working: { control: 'stopping' } }, value)
		}
	})

	return model.createMachine({
		id: 'organization-save',
		initial: 'identifying',
		context: ({ input }) => ({
			request: { ...input },
			operations: [],
			operationId: '',
			result: undefined
		}),
		output: ({ context }) => required(context.result),
		states: {
			identifying: {
				initial: 'active',
				states: { active: {}, stopping: {} },
				invoke: {
					id: 'identity',
					src: 'identity',
					onDone: ({ event, value }) => ({
						target: matchesState({ identifying: 'stopping' }, value) ? 'interrupted' : 'admitting',
						context: { operationId: event.output }
					})
				},
				on: { SHUTDOWN: { target: '.stopping' } }
			},
			admitting: {
				type: 'choice',
				choice: (args) => {
					if (args.guards.stale()) {
						return { target: 'interrupted' }
					}
					return { target: 'working' }
				}
			},
			working: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						states: { active: { on: { SHUTDOWN: { target: 'stopping' } } }, stopping: {} }
					},
					work: {
						initial: 'observing',
						states: {
							observing: {
								type: 'choice',
								choice: (args) => {
									if (args.guards.tagRequest(args)) {
										return { target: 'observingTags' }
									}
									return { target: 'observingProperty' }
								}
							},
							observingTags: {
								invoke: {
									src: 'tagHistory',
									input: ({
										context
									}: {
										context: {
											request: OrganizationRequest | undefined
											operations: OrganizationHistory[]
											operationId: string
											result: SaveResult | undefined
										}
									}) => required(context.request),
									onDone: (args) => {
										if (matchesState({ working: { control: 'stopping' } }, args.value)) {
											return { target: '#organization-save.interrupted' }
										}
										if (args.guards.stale()) {
											return { target: '#organization-save.interrupted' }
										}
										return { target: 'writing', context: { operations: args.event.output } }
									},
									onError: (args) => {
										if (matchesState({ working: { control: 'stopping' } }, args.value)) {
											return { target: '#organization-save.interrupted' }
										}
										if (args.guards.stale()) {
											return { target: '#organization-save.interrupted' }
										}
										return { target: '#organization-save.failed' }
									}
								}
							},
							observingProperty: {
								invoke: {
									src: 'history',
									input: ({
										context
									}: {
										context: {
											request: OrganizationRequest | undefined
											operations: OrganizationHistory[]
											operationId: string
											result: SaveResult | undefined
										}
									}) => required(context.request),
									onDone: (args) => {
										if (matchesState({ working: { control: 'stopping' } }, args.value)) {
											return { target: '#organization-save.interrupted' }
										}
										if (args.guards.stale()) {
											return { target: '#organization-save.interrupted' }
										}
										return { target: 'writing', context: { operations: args.event.output } }
									},
									onError: (args) => {
										if (matchesState({ working: { control: 'stopping' } }, args.value)) {
											return { target: '#organization-save.interrupted' }
										}
										if (args.guards.stale()) {
											return { target: '#organization-save.interrupted' }
										}
										return { target: '#organization-save.failed' }
									}
								}
							},
							writing: {
								invoke: {
									id: 'stage',
									src: 'operation',
									input: ({ context }) => ({
										operationId: context.operationId,
										spawn: stage,
										input: {
											attempt: {
												operationId: context.operationId,
												workspaceId: context.operationId,
												membershipId: context.operationId,
												draft: { ...required(context.request), operations: context.operations }
											}
										}
									}),
									onDone: (args) => {
										const operation = args.event.output
										if (operation.kind === 'failed') return { target: '#organization-save.unknown' }
										const output = operation.output

										if (!output || output.settlement.kind === 'unresolved') {
											return { target: '#organization-save.unknown' }
										}
										if (matchesState({ working: { control: 'stopping' } }, args.value)) {
											return { target: '#organization-save.interrupted' }
										}
										if (args.guards.stale()) {
											return { target: '#organization-save.interrupted' }
										}
										if (output?.settlement.kind === 'locallyPersisted') {
											return {
												target: '#organization-save.saved',
												context: {
													result: {
														kind: 'saved',
														operationId: args.context.operationId,
														receipts:
															output?.settlement.kind === 'locallyPersisted'
																? [output.settlement.workspace]
																: []
													}
												}
											}
										}
										return { target: '#organization-save.failed' }
									},
									onError: { target: '#organization-save.unknown' }
								},
								on: {
									SHUTDOWN: (_, enq) => {
										enq.sendTo('stage', { type: 'INTERRUPT', command: { type: 'SHUTDOWN' } })
									}
								}
							}
						}
					}
				}
			},
			saved: {
				type: 'final',
				entry: () => {
					return { context: { request: undefined, operations: [] } }
				}
			},
			unknown: {
				type: 'final',
				entry: (args) => {
					return {
						context: {
							result: { kind: 'unknown', operationId: args.context.operationId },
							request: undefined,
							operations: []
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
							operations: []
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
							operations: []
						}
					}
				}
			}
		}
	})
}
