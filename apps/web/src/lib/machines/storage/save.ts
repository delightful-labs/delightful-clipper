import type { Snapshot } from 'xstate'
import { assign, enqueueActions, fromPromise, setup, stateIn } from 'xstate'
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
function prepared(context: Context) {
	if (!context.prepared) throw new Error('Missing prepared record')
	return context.prepared
}
function stageResultKind(
	output: StageResult | undefined,
	isCurrent: () => boolean
): Exclude<SaveResult['kind'], 'saved'> {
	if (!output || output.settlement.kind === 'unresolved') return 'unknown'
	if (!isCurrent()) return 'scopeChanged'
	if (output?.outcome === 'blocked') return 'blocked'
	if (output?.outcome === 'closed') return 'interrupted'
	return 'failed'
}

export function createSaveRecordMachine<S extends Snapshot<StageResult>>(
	capability: SaveCapabilities<S>
) {
	const actors = {
		prepare: fromPromise(({ input }: { input: SaveRequest }) => capability.prepare(input)),
		intent: capability.intent,
		publish: capability.publish
	}
	type FullContext = Context
	const model = setup<
		FullContext,
		{ type: 'SHUTDOWN' },
		typeof actors,
		{},
		{ shutdownChild: undefined; scopeChanged: undefined },
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
		},
		actions: {
			scopeChanged: assign(({ context }) => ({
				result: { kind: 'scopeChanged', operationId: context.operationId } satisfies SaveResult
			})),
			shutdownChild: enqueueActions(({ self, enqueue }) => {
				for (const id of ['intent', 'publish']) {
					const child = self.getSnapshot().children[id]
					if (child?.getSnapshot().status === 'active') enqueue.sendTo(child, { type: 'SHUTDOWN' })
				}
			})
		}
	})
	const input = ({ context }: { context: Context }) => ({
		attempt: {
			operationId: context.operationId,
			workspaceId: context.operationId,
			membershipId: context.operationId,
			draft: prepared(context)
		}
	})
	const stageOutput = ({
		context,
		event
	}: {
		context: FullContext
		event: { output: StageResult | undefined }
	}) => ({
		receipts:
			event.output?.settlement.kind === 'locallyPersisted'
				? [...context.receipts, event.output.settlement.workspace]
				: context.receipts,
		result: {
			kind: stageResultKind(event.output, capability.isCurrent),
			operationId: context.operationId
		} satisfies SaveResult
	})
	const stage = (src: 'intent' | 'publish', next: 'publish' | 'saved') =>
		model.createStateConfig({
			invoke: {
				id: src,
				src,
				input,
				onDone: [
					{
						guard: ({ event }) => !event.output || event.output.settlement.kind === 'unresolved',
						target: 'finishing',
						actions: assign(({ context, event }) =>
							stageOutput({ context, event: { output: event.output } })
						)
					},
					{
						guard: 'stopping',
						target: 'finishing',
						actions: [
							assign(({ context, event }) =>
								stageOutput({ context, event: { output: event.output } })
							),
							assign(({ context }) => ({
								result: {
									kind: 'interrupted',
									operationId: context.operationId
								} satisfies SaveResult
							}))
						]
					},
					{
						guard: ({ event }) => event.output?.outcome === 'succeeded' && capability.isCurrent(),
						target: next,
						actions: assign(({ context, event }) =>
							stageOutput({ context, event: { output: event.output } })
						)
					},
					{
						target: 'finishing',
						actions: assign(({ context, event }) =>
							stageOutput({ context, event: { output: event.output } })
						)
					}
				],
				onError: {
					target: 'finishing',
					actions: assign(({ context }) => ({
						result: { kind: 'unknown', operationId: context.operationId } satisfies SaveResult
					}))
				}
			}
		})
	return model.createMachine({
		id: 'save-record',
		initial: 'running',
		context: ({ input }) => ({
			request: input,
			operationId: input.operationId,
			prepared: undefined,
			receipts: [],
			result: undefined
		}),
		output: ({ context }) => {
			if (!context.result) throw new Error('Missing storage outcome')
			return context.result
		},
		states: {
			running: {
				type: 'parallel',
				states: {
					control: {
						initial: 'active',
						states: {
							active: { on: { SHUTDOWN: { target: 'stopping', actions: 'shutdownChild' } } },
							stopping: { on: { SHUTDOWN: {} } }
						}
					},
					work: {
						initial: 'admitting',
						states: {
							admitting: {
								always: [
									{
										guard: 'scopeLost',
										target: 'finishing',
										actions: 'scopeChanged'
									},
									{ target: 'preparing' }
								]
							},
							preparing: {
								invoke: {
									src: 'prepare',
									input: ({ context }) => {
										if (!context.request) throw new Error('Missing request')
										return context.request
									},
									onDone: [
										{ guard: 'stopping', target: 'finishing' },
										{
											guard: 'scopeLost',
											target: 'finishing',
											actions: 'scopeChanged'
										},
										{
											target: 'intent',
											actions: assign({ prepared: ({ event }) => event.output, request: undefined })
										}
									],
									onError: [
										{
											guard: 'scopeLost',
											target: 'finishing',
											actions: 'scopeChanged'
										},
										{
											target: 'finishing',
											actions: assign(({ context }) => ({
												result: {
													kind: 'failed',
													operationId: context.operationId
												} satisfies SaveResult
											}))
										}
									]
								}
							},
							intent: stage('intent', 'publish'),
							publish: stage('publish', 'saved'),
							saved: {
								entry: assign(({ context }) => ({
									result: {
										kind: 'saved',
										operationId: context.operationId,
										receipts: context.receipts
									} satisfies SaveResult
								})),
								always: 'finishing'
							},
							finishing: {
								always: [
									{
										guard: 'stopping',
										target: '#save-record.done',
										actions: assign(({ context }) => ({
											result:
												context.result?.kind === 'unknown'
													? context.result
													: ({
															kind: 'interrupted',
															operationId: context.operationId
														} satisfies SaveResult)
										}))
									},
									{ target: '#save-record.done' }
								]
							}
						}
					}
				}
			},
			done: {
				type: 'final',
				entry: assign(({ context }) => ({
					request: undefined,
					prepared: undefined,
					receipts: [],
					result:
						context.result ??
						({
							kind: capability.isCurrent() ? 'failed' : 'scopeChanged',
							operationId: context.operationId
						} satisfies SaveResult)
				}))
			}
		}
	})
}
