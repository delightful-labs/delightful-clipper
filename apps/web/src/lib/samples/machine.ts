import type { EventPayload } from '../machines/events.js'
import { types, setup, createAsyncLogic, matchesState, type Snapshot } from 'xstate'

import type { WorkspaceCreationResult } from 'delightful-local-first/workspace/creation/contracts'
import type { FakeDataPlan } from './plan.js'
export type FakeDataOutcome = 'seeded' | 'skipped' | 'failed' | 'unknown' | 'closed'
export type SeedRows = { hasData: boolean; owned: boolean }
export function canSeedLibrary(rows: SeedRows) {
	return !rows.hasData && rows.owned
}
export function createFakeDataMachine(cap: {
	enabled: boolean
	isCurrent: () => boolean
	libraryId: string
	local: () => Promise<SeedRows>
	authority: () => Promise<SeedRows>
	stage: (
		spawn: import('../machines/children.js').ChildSpawner,
		input: {
			attempt: {
				operationId: string
				workspaceId: string
				membershipId: string
				draft: FakeDataPlan
			}
		}
	) => import('xstate').ActorInstance<
		Snapshot<WorkspaceCreationResult<FakeDataPlan, number>>,
		{ type: 'SHUTDOWN' | 'CANCEL' }
	>
}) {
	const actors = {
		local: createAsyncLogic({ run: () => cap.local() }),
		authority: createAsyncLogic({ run: () => cap.authority() }),
		prepare: createAsyncLogic({
			run: async () => (await import('./plan.js')).prepareFakeData(cap.libraryId)
		})
	}
	const model = setup({
		schemas: {
			context: types<{
				plan: FakeDataPlan
				outcome: FakeDataOutcome
				ownedStage:
					| import('xstate').ActorInstance<
							import('xstate').Snapshot<WorkspaceCreationResult<FakeDataPlan, number>>,
							{ type: 'SHUTDOWN' | 'CANCEL' }
					  >
					| undefined
			}>(),
			events: {
				STAGE_DONE: types<{
					actorId: string
					output: WorkspaceCreationResult<FakeDataPlan, number>
				}>(),
				STAGE_ERROR: types<{ actorId: string; error: unknown }>(),
				SHUTDOWN: types<EventPayload<{ type: 'SHUTDOWN' }, 'SHUTDOWN'>>()
			},
			input: types<undefined>(),
			output: types<FakeDataOutcome>(),
			tags: types<string>(),
			children: {
				local: types<import('xstate').ActorRefFrom<(typeof actors)['local']>>(),
				authority: types<import('xstate').ActorRefFrom<(typeof actors)['authority']>>(),
				prepare: types<import('xstate').ActorRefFrom<(typeof actors)['prepare']>>()
			}
		},
		actors,
		guards: {
			stopping: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ writing: 'stopping' }, value)
		}
	})
	const terminal = (outcome: FakeDataOutcome) =>
		model.createStateConfig({
			type: 'final',
			entry: () => {
				return { context: { outcome, plan: [] } }
			}
		})
	return model.createMachine({
		id: 'library-fake-data',
		initial: 'checking',
		context: { plan: [], outcome: 'skipped', ownedStage: undefined },
		output: ({ context }) => context.outcome,
		states: {
			checking: {
				type: 'choice',
				choice: () => {
					if (cap.enabled && cap.isCurrent()) {
						return { target: 'local' }
					}
					return { target: 'skipped' }
				}
			},
			local: {
				on: { SHUTDOWN: { target: 'closed' } },
				invoke: {
					id: 'local',
					src: 'local',
					onDone: (args) => {
						if (args.event.output.hasData) {
							return { target: 'skipped' }
						}
						return { target: 'authority' }
					},
					onError: { target: 'failed' }
				}
			},
			authority: {
				after: { 5000: { target: 'skipped' } },
				on: { SHUTDOWN: { target: 'closed' } },
				invoke: {
					id: 'authority',
					src: 'authority',
					onDone: (args) => {
						if (canSeedLibrary(args.event.output) && cap.isCurrent()) {
							return { target: 'preparing' }
						}
						return { target: 'skipped' }
					},
					onError: { target: 'skipped' }
				}
			},
			preparing: {
				on: { SHUTDOWN: { target: 'closed' } },
				invoke: {
					id: 'prepare',
					src: 'prepare',
					onDone: (args) => {
						return { target: 'writing', context: { plan: args.event.output } }
					},
					onError: { target: 'failed' }
				}
			},
			writing: {
				initial: 'active',
				states: {
					active: {
						on: {
							SHUTDOWN: (args, enq) => {
								enq.sendTo(args.context.ownedStage, { type: 'SHUTDOWN' })
								return { target: 'stopping' }
							}
						}
					},
					stopping: { on: { SHUTDOWN: {} } }
				},
				entry: (args, enq) => {
					const ref = cap.stage(
						enq.spawn,
						(({ context }: { context: { plan: FakeDataPlan; outcome: FakeDataOutcome } }) => ({
							attempt: {
								operationId: cap.libraryId,
								workspaceId: cap.libraryId,
								membershipId: cap.libraryId,
								draft: context.plan
							}
						}))(args)
					)
					enq.subscribeTo(ref, {
						done: (
							output
						):
							| ({ type: 'STAGE_DONE' } & {
									actorId: string
									output: WorkspaceCreationResult<FakeDataPlan, number>
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
									output: WorkspaceCreationResult<FakeDataPlan, number>
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
						if (matchesState({ writing: 'stopping' }, args.value)) {
							return { target: 'closed' }
						}
						if (event.output?.outcome === 'succeeded') {
							return { target: 'seeded' }
						}
						if (event.output?.outcome === 'blocked') {
							return { target: 'skipped' }
						}
						if (event.output?.settlement.kind === 'unresolved') {
							return { target: 'unknown' }
						}
						return { target: 'failed' }
					},
					STAGE_ERROR: { target: 'unknown' }
				}
			},
			seeded: terminal('seeded'),
			skipped: terminal('skipped'),
			failed: terminal('failed'),
			unknown: terminal('unknown'),
			closed: terminal('closed')
		}
	})
}
