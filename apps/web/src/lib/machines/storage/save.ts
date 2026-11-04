import type { Snapshot } from 'xstate'
import { assign, fromPromise, setup, stateIn, sendTo } from 'xstate'
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
export function createSaveRecordMachine<S extends Snapshot<StageResult>>(
	capability: SaveCapabilities<S>
) {
	const actors = {
		prepare: fromPromise(({ input }: { input: SaveRequest }) => capability.prepare(input)),
		intent: capability.intent,
		publish: capability.publish
	}
	const model = setup<
		Context,
		{ type: 'SHUTDOWN' },
		typeof actors,
		{},
		{},
		{ stopping: undefined; scopeLost: undefined },
		never,
		string,
		SaveRequest,
		SaveResult
	>({
		actors,
		guards: {
			stopping: stateIn({ running: { control: 'stopping' } }),
			scopeLost: () => !capability.isCurrent()
		}
	})
	const interrupts = [
		{ guard: 'stopping' as const, target: '#save-record.interrupted' },
		{ guard: 'scopeLost' as const, target: '#save-record.scopeChanged' }
	]
	const stage = (src: 'intent' | 'publish', next: 'publish' | '#save-record.saved') =>
		model.createStateConfig({
			initial: 'active',
			states: {
				active: {
					on: { SHUTDOWN: { target: 'stopping', actions: sendTo(src, { type: 'SHUTDOWN' }) } }
				},
				stopping: {}
			},
			invoke: {
				id: src,
				src,
				input: ({ context }) => ({
					attempt: {
						operationId: context.operationId,
						workspaceId: context.operationId,
						membershipId: context.operationId,
						draft: required(context.prepared)
					}
				}),
				onDone: [
					{
						guard: ({ event }) => !event.output || event.output.settlement.kind === 'unresolved',
						target: '#save-record.unknown'
					},
					...interrupts,
					{
						guard: ({ event }) => event.output?.outcome === 'succeeded',
						target: next,
						actions: assign({
							receipts: ({ context, event }) =>
								event.output?.settlement.kind === 'locallyPersisted'
									? [...context.receipts, event.output.settlement.workspace]
									: context.receipts
						})
					},
					{
						guard: ({ event }) => event.output?.outcome === 'blocked',
						target: '#save-record.blocked'
					},
					{
						guard: ({ event }) => event.output?.outcome === 'closed',
						target: '#save-record.interrupted'
					},
					{ target: '#save-record.failed' }
				],
				onError: '#save-record.unknown'
			}
		})
	const terminal = (kind: Exclude<SaveResult['kind'], 'saved'>) =>
		model.createStateConfig({
			type: 'final',
			entry: assign({
				result: ({ context }) => ({ kind, operationId: context.operationId }),
				request: undefined,
				prepared: undefined,
				receipts: []
			})
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
						states: { active: { on: { SHUTDOWN: 'stopping' } }, stopping: {} }
					},
					work: {
						initial: 'admitting',
						states: {
							admitting: { always: [...interrupts, { target: 'preparing' }] },
							preparing: {
								invoke: {
									src: 'prepare',
									input: ({ context }) => required(context.request),
									onDone: [
										...interrupts,
										{
											target: 'intent',
											actions: assign({ prepared: ({ event }) => event.output, request: undefined })
										}
									],
									onError: [...interrupts, { target: '#save-record.failed' }]
								}
							},
							intent: stage('intent', 'publish'),
							publish: stage('publish', '#save-record.saved')
						}
					}
				}
			},
			saved: {
				type: 'final',
				entry: assign({
					result: ({ context }) => ({
						kind: 'saved',
						operationId: context.operationId,
						receipts: context.receipts
					}),
					request: undefined,
					prepared: undefined,
					receipts: []
				})
			},
			unknown: terminal('unknown'),
			interrupted: terminal('interrupted'),
			scopeChanged: terminal('scopeChanged'),
			blocked: terminal('blocked'),
			failed: terminal('failed')
		}
	})
}
