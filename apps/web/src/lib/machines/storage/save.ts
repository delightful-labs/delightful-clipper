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
export function createSaveRecordMachine<S extends Snapshot<StageResult>>(
	capability: SaveCapabilities<S>
) {
	const actors = {
		prepare: fromPromise(({ input }: { input: SaveRequest }) => capability.prepare(input)),
		intent: capability.intent,
		parts: capability.parts,
		publish: capability.publish,
		readParts: fromPromise(({ input }: { input: string }) => capability.readParts(input)),
		verify: fromPromise(
			({
				input
			}: {
				input: { manifest: PreparedSave['manifest']; parts: PreparedSave['parts'] }
			}) => capability.verify(input)
		)
	}
	type FullContext = Context & { observedParts: PreparedSave['parts'] }
	const model = setup<
		FullContext,
		{ type: 'SHUTDOWN' },
		typeof actors,
		{},
		{ shutdownChild: undefined },
		{ stopping: undefined },
		never,
		string,
		SaveRequest,
		SaveResult
	>({
		actors,
		guards: { stopping: stateIn({ running: { control: 'stopping' } }) },
		actions: {
			shutdownChild: enqueueActions(({ self, enqueue }) => {
				for (const id of ['intent', 'parts', 'publish']) {
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
			kind:
				event.output?.settlement.kind === 'unresolved'
					? 'unknown'
					: !capability.isCurrent()
						? 'scopeChanged'
						: event.output?.outcome === 'blocked'
							? 'blocked'
							: event.output?.outcome === 'closed'
								? 'interrupted'
								: 'failed',
			operationId: context.operationId
		} satisfies SaveResult
	})
	const stage = (src: 'intent' | 'parts' | 'publish', next: 'parts' | 'readingParts' | 'saved') =>
		model.createStateConfig({
			invoke: {
				id: src,
				src,
				input,
				onDone: [
					{
						guard: ({ event }) => event.output?.settlement.kind === 'unresolved',
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
			observedParts: [],
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
						initial: 'preparing',
						states: {
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
											target: 'intent',
											actions: assign({ prepared: ({ event }) => event.output, request: undefined })
										}
									],
									onError: {
										target: 'finishing',
										actions: assign(({ context }) => ({
											result: {
												kind: 'failed',
												operationId: context.operationId
											} satisfies SaveResult
										}))
									}
								}
							},
							intent: stage('intent', 'parts'),
							parts: stage('parts', 'readingParts'),
							readingParts: {
								invoke: {
									src: 'readParts',
									input: ({ context }) => context.operationId,
									onDone: [
										{ guard: 'stopping', target: 'finishing' },
										{
											target: 'verifying',
											actions: assign({ observedParts: ({ event }) => event.output })
										}
									],
									onError: 'finishing'
								}
							},
							verifying: {
								invoke: {
									src: 'verify',
									input: ({ context }) => ({
										manifest: prepared(context).manifest,
										parts: context.observedParts
									}),
									onDone: [
										{ guard: 'stopping', target: 'finishing' },
										{ guard: () => capability.isCurrent(), target: 'publish' },
										{
											target: 'finishing',
											actions: assign(({ context }) => ({
												result: {
													kind: 'scopeChanged',
													operationId: context.operationId
												} satisfies SaveResult
											}))
										}
									],
									onError: 'finishing'
								}
							},
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
					observedParts: [],
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
