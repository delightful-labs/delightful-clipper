import { assign, setup, sendTo, stateIn } from 'xstate'
import type { ActorLogic, Snapshot } from 'xstate'
import type { WorkspaceCreationResult } from 'delightful-local-first/workspace/creation/contracts'
import type { OrganizationRequest } from '../../capture/organization.js'
import type { SaveResult, SyncReceipt } from '../../contracts/storage.js'
export type OrganizationStageResult = WorkspaceCreationResult<OrganizationRequest, SyncReceipt>
export type OrganizationStage<S extends Snapshot<OrganizationStageResult>> = ActorLogic<
	S,
	{ type: 'SHUTDOWN' | 'CANCEL' },
	{
		attempt: {
			operationId: string
			workspaceId: string
			membershipId: string
			draft: OrganizationRequest
		}
	}
>
function required<T>(v: T | undefined): T {
	if (v === undefined) throw new Error('Missing organization resource')
	return v
}
export function createOrganizationMachine<S extends Snapshot<OrganizationStageResult>>(
	stage: OrganizationStage<S>,
	isCurrent: () => boolean
) {
	const model = setup<
		{
			request: OrganizationRequest | undefined
			operationId: string
			result: SaveResult | undefined
		},
		{ type: 'SHUTDOWN' },
		{ stage: typeof stage },
		{},
		{},
		{ stale: undefined; stopping: undefined },
		never,
		string,
		OrganizationRequest,
		SaveResult
	>({
		actors: { stage },
		guards: { stale: () => !isCurrent(), stopping: stateIn({ writing: 'stopping' }) }
	})
	const terminal = (kind: Exclude<SaveResult['kind'], 'saved'>) =>
		model.createStateConfig({
			type: 'final',
			entry: assign({
				result: ({ context }) => ({ kind, operationId: context.operationId }),
				request: undefined
			})
		})
	return model.createMachine({
		id: 'organization-save',
		initial: 'admitting',
		context: ({ input }) => ({
			request: input,
			operationId: crypto.randomUUID(),
			result: undefined
		}),
		output: ({ context }) => required(context.result),
		states: {
			admitting: { always: [{ guard: 'stale', target: 'interrupted' }, { target: 'writing' }] },
			writing: {
				initial: 'active',
				states: {
					active: {
						on: { SHUTDOWN: { target: 'stopping', actions: sendTo('stage', { type: 'SHUTDOWN' }) } }
					},
					stopping: {}
				},
				invoke: {
					id: 'stage',
					src: 'stage',
					input: ({ context }) => ({
						attempt: {
							operationId: context.operationId,
							workspaceId: context.operationId,
							membershipId: context.operationId,
							draft: required(context.request)
						}
					}),
					onDone: [
						{
							guard: ({ event }) => !event.output || event.output.settlement.kind === 'unresolved',
							target: 'unknown'
						},
						{ guard: 'stopping', target: 'interrupted' },
						{ guard: 'stale', target: 'interrupted' },
						{
							guard: ({ event }) => event.output?.settlement.kind === 'locallyPersisted',
							target: 'saved',
							actions: assign({
								result: ({ context, event }) => ({
									kind: 'saved',
									operationId: context.operationId,
									receipts:
										event.output?.settlement.kind === 'locallyPersisted'
											? [event.output.settlement.workspace]
											: []
								})
							})
						},
						{ target: 'failed' }
					],
					onError: 'unknown'
				}
			},
			saved: { type: 'final', entry: assign({ request: undefined }) },
			unknown: terminal('unknown'),
			interrupted: terminal('interrupted'),
			failed: terminal('failed')
		}
	})
}
