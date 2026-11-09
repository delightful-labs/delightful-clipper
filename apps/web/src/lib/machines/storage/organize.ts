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
	const model = setup({
		schemas: {
			context: types<{
				request: OrganizationRequest | undefined
				operations: OrganizationHistory[]
				operationId: string
				result: SaveResult | undefined
				ownedStage:
					| import('xstate').ActorInstance<
							import('xstate').Snapshot<OrganizationStageResult>,
							{ type: 'SHUTDOWN' | 'CANCEL' }
					  >
					| undefined
			}>(),
			events: {
				STAGE_DONE: types<{ actorId: string; output: OrganizationStageResult }>(),
				STAGE_ERROR: types<{ actorId: string; error: unknown }>(),
				SHUTDOWN: types<EventPayload<{ type: 'SHUTDOWN' }, 'SHUTDOWN'>>()
			},
			input: types<OrganizationRequest>(),
			output: types<SaveResult>(),
			tags: types<string>(),
			children: {
				identity: types<import('xstate').ActorRefFrom<typeof identityLogic>>(),
				history: types<import('xstate').ActorRefFrom<typeof history>>(),
				tagHistory: types<import('xstate').ActorRefFrom<typeof tagHistory>>()
			}
		},
		actors: { history, tagHistory, identity: identityLogic },
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
			result: undefined,
			ownedStage: undefined
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
				type: 'parallel' as const,
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
								initial: 'active',
								states: {
									active: {
										on: {
											SHUTDOWN: (args, enq) => {
												enq.sendTo(args.context.ownedStage, { type: 'SHUTDOWN' as const })
												return { target: 'stopping' }
											}
										}
									},
									stopping: {}
								},
								entry: (args, enq) => {
									const ref = stage(
										enq.spawn,
										(({
											context
										}: {
											context: {
												request: OrganizationRequest | undefined
												operations: OrganizationHistory[]
												operationId: string
												result: SaveResult | undefined
											}
										}) => ({
											attempt: {
												operationId: context.operationId,
												workspaceId: context.operationId,
												membershipId: context.operationId,
												draft: { ...required(context.request), operations: context.operations }
											}
										}))(args)
									)
									enq.subscribeTo(ref, {
										done: (
											output
										):
											| ({ type: 'STAGE_DONE' } & {
													actorId: string
													output: OrganizationStageResult
											  })
											| ({ type: 'STAGE_ERROR' } & { actorId: string; error: unknown }) => ({
											type: 'STAGE_DONE',
											actorId: ref.id,
											output
										}),
										error: (
											error
										):
											| ({ type: 'STAGE_DONE' } & {
													actorId: string
													output: OrganizationStageResult
											  })
											| ({ type: 'STAGE_ERROR' } & { actorId: string; error: unknown }) => ({
											type: 'STAGE_ERROR',
											actorId: ref.id,
											error
										})
									})
									return { context: { ownedStage: ref } }
								},
								exit: ({ context }, enq) => {
									enq.stop(context.ownedStage)
									return { context: { ownedStage: undefined } }
								},
								on: {
									STAGE_DONE: (args) => {
										const { event } = args
										if (!event.output || event.output.settlement.kind === 'unresolved') {
											return { target: '#organization-save.unknown' }
										}
										if (matchesState({ working: { control: 'stopping' } }, args.value)) {
											return { target: '#organization-save.interrupted' }
										}
										if (args.guards.stale()) {
											return { target: '#organization-save.interrupted' }
										}
										if (event.output?.settlement.kind === 'locallyPersisted') {
											return {
												target: '#organization-save.saved',
												context: {
													result: {
														kind: 'saved' as const,
														operationId: args.context.operationId,
														receipts:
															event.output?.settlement.kind === 'locallyPersisted'
																? [event.output.settlement.workspace]
																: []
													}
												}
											}
										}
										return { target: '#organization-save.failed' }
									},
									STAGE_ERROR: { target: '#organization-save.unknown' }
								}
							}
						}
					}
				}
			},
			saved: {
				type: 'final' as const,
				entry: () => {
					return { context: { request: undefined, operations: [] } }
				}
			},
			unknown: {
				type: 'final' as const,
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
				type: 'final' as const,
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
				type: 'final' as const,
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
