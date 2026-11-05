import { assign, fromPromise, setup, sendTo, stateIn } from 'xstate'
import type { ActorLogic, Snapshot } from 'xstate'
import type { WorkspaceCreationResult } from 'delightful-local-first/workspace/creation/contracts'
import type { FakeDataPlan } from './plan.js'
export type FakeDataOutcome = 'seeded' | 'skipped' | 'failed' | 'unknown' | 'closed'
export type SeedRows = { hasData: boolean; owned: boolean }
export function canSeedLibrary(rows: SeedRows) {
	return !rows.hasData && rows.owned
}
export function createFakeDataMachine<
	S extends Snapshot<WorkspaceCreationResult<FakeDataPlan, number>>
>(cap: {
	enabled: boolean
	isCurrent: () => boolean
	libraryId: string
	local: () => Promise<SeedRows>
	authority: () => Promise<SeedRows>
	stage: ActorLogic<
		S,
		{ type: 'SHUTDOWN' | 'CANCEL' },
		{
			attempt: {
				operationId: string
				workspaceId: string
				membershipId: string
				draft: FakeDataPlan
			}
		}
	>
}) {
	const actors = {
		local: fromPromise(() => cap.local()),
		authority: fromPromise(() => cap.authority()),
		prepare: fromPromise(async () => (await import('./plan.js')).prepareFakeData(cap.libraryId)),
		stage: cap.stage
	}
	const model = setup<
		{ plan: FakeDataPlan; outcome: FakeDataOutcome },
		{ type: 'SHUTDOWN' },
		typeof actors,
		{},
		{},
		{ stopping: undefined },
		never,
		string,
		undefined,
		FakeDataOutcome
	>({ actors, guards: { stopping: stateIn({ writing: 'stopping' }) } })
	const terminal = (outcome: FakeDataOutcome) =>
		model.createStateConfig({ type: 'final', entry: model.assign({ outcome, plan: [] }) })
	return model.createMachine({
		id: 'library-fake-data',
		initial: 'checking',
		context: { plan: [], outcome: 'skipped' },
		output: ({ context }) => context.outcome,
		states: {
			checking: {
				always: [
					{ guard: () => cap.enabled && cap.isCurrent(), target: 'local' },
					{ target: 'skipped' }
				]
			},
			local: {
				on: { SHUTDOWN: 'closed' },
				invoke: {
					src: 'local',
					onDone: [
						{ guard: ({ event }) => event.output.hasData, target: 'skipped' },
						{ target: 'authority' }
					],
					onError: 'failed'
				}
			},
			authority: {
				after: { 5000: 'skipped' },
				on: { SHUTDOWN: 'closed' },
				invoke: {
					src: 'authority',
					onDone: [
						{
							guard: ({ event }) => canSeedLibrary(event.output) && cap.isCurrent(),
							target: 'preparing'
						},
						{ target: 'skipped' }
					],
					onError: 'skipped'
				}
			},
			preparing: {
				on: { SHUTDOWN: 'closed' },
				invoke: {
					src: 'prepare',
					onDone: { target: 'writing', actions: assign({ plan: ({ event }) => event.output }) },
					onError: 'failed'
				}
			},
			writing: {
				initial: 'active',
				states: {
					active: {
						on: { SHUTDOWN: { target: 'stopping', actions: sendTo('stage', { type: 'SHUTDOWN' }) } }
					},
					stopping: { on: { SHUTDOWN: {} } }
				},
				invoke: {
					id: 'stage',
					src: 'stage',
					input: ({ context }) => ({
						attempt: {
							operationId: cap.libraryId,
							workspaceId: cap.libraryId,
							membershipId: cap.libraryId,
							draft: context.plan
						}
					}),
					onDone: [
						{ guard: 'stopping', target: 'closed' },
						{ guard: ({ event }) => event.output?.outcome === 'succeeded', target: 'seeded' },
						{ guard: ({ event }) => event.output?.outcome === 'blocked', target: 'skipped' },
						{
							guard: ({ event }) => event.output?.settlement.kind === 'unresolved',
							target: 'unknown'
						},
						{ target: 'failed' }
					],
					onError: 'unknown'
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
