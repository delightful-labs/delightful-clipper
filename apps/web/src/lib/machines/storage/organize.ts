import { assign, setup, sendTo, stateIn, fromPromise } from 'xstate'
import type { ActorLogic, Snapshot } from 'xstate'
import type { WorkspaceCreationResult } from 'delightful-local-first/workspace/creation/contracts'
import type { OrganizationRequest, OrganizationOperation } from '../../capture/organization.js'
import type { SaveResult, SyncReceipt } from '../../contracts/storage.js'
export type OrganizationDraft = OrganizationRequest & { operations: OrganizationOperation[] }
export type OrganizationStageResult = WorkspaceCreationResult<OrganizationDraft, SyncReceipt>
export type OrganizationStage<S extends Snapshot<OrganizationStageResult>> = ActorLogic<
	S,
	{ type: 'SHUTDOWN' | 'CANCEL' },
	{
		attempt: {
			operationId: string
			workspaceId: string
			membershipId: string
			draft: OrganizationDraft
		}
	}
>
function required<T>(v: T | undefined): T {
	if (v === undefined) throw new Error('Missing organization resource')
	return v
}
export function createOrganizationMachine<S extends Snapshot<OrganizationStageResult>>(
	stage: OrganizationStage<S>,
	isCurrent: () => boolean,
	observe: (request: OrganizationRequest) => Promise<OrganizationOperation[]> = async () => []
) {
	const history = fromPromise(({ input }: { input: OrganizationRequest }) => observe(input))
	const model = setup<
		{
			request: OrganizationRequest | undefined
			operations: OrganizationOperation[]
			operationId: string
			result: SaveResult | undefined
		},
		{ type: 'SHUTDOWN' },
		{ stage: typeof stage; history: typeof history },
		{},
		{},
		{ stale: undefined; stopping: undefined },
		never,
		string,
		OrganizationRequest,
		SaveResult
	>({
		actors: { stage, history },
		guards: { stale: () => !isCurrent(), stopping: stateIn({ working: { control: 'stopping' } }) }
	})
	const terminal = (kind: Exclude<SaveResult['kind'], 'saved'>) =>
		model.createStateConfig({
			type: 'final',
			entry: assign({
				result: ({ context }) => ({ kind, operationId: context.operationId }),
				request: undefined,
				operations: []
			})
		})
	return model.createMachine({
		id: 'organization-save',
		initial: 'admitting',
		context: ({ input }) => ({
			request: { ...input },
			operations: [],
			operationId: crypto.randomUUID(),
			result: undefined
		}),
		output: ({ context }) => required(context.result),
		states: {
			admitting: { always: [{ guard: 'stale', target: 'interrupted' }, { target: 'working' }] },
			working: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						states: { active: { on: { SHUTDOWN: 'stopping' } }, stopping: {} }
					},
					work: {
						initial: 'observing',
						states: {
							observing: {
								invoke: {
									src: 'history',
									input: ({ context }) => required(context.request),
									onDone: [
										{ guard: 'stopping', target: '#organization-save.interrupted' },
										{ guard: 'stale', target: '#organization-save.interrupted' },
										{
											target: 'writing',
											actions: assign({ operations: ({ event }) => event.output })
										}
									],
									onError: [
										{ guard: 'stopping', target: '#organization-save.interrupted' },
										{ guard: 'stale', target: '#organization-save.interrupted' },
										{ target: '#organization-save.failed' }
									]
								}
							},
							writing: {
								initial: 'active',
								states: {
									active: {
										on: {
											SHUTDOWN: {
												target: 'stopping',
												actions: sendTo('stage', { type: 'SHUTDOWN' })
											}
										}
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
											draft: { ...required(context.request), operations: context.operations }
										}
									}),
									onDone: [
										{
											guard: ({ event }) =>
												!event.output || event.output.settlement.kind === 'unresolved',
											target: '#organization-save.unknown'
										},
										{ guard: 'stopping', target: '#organization-save.interrupted' },
										{ guard: 'stale', target: '#organization-save.interrupted' },
										{
											guard: ({ event }) => event.output?.settlement.kind === 'locallyPersisted',
											target: '#organization-save.saved',
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
										{ target: '#organization-save.failed' }
									],
									onError: '#organization-save.unknown'
								}
							}
						}
					}
				}
			},
			saved: { type: 'final', entry: assign({ request: undefined, operations: [] }) },
			unknown: terminal('unknown'),
			interrupted: terminal('interrupted'),
			failed: terminal('failed')
		}
	})
}
