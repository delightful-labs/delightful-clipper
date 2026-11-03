import { assign, enqueueActions, fromPromise, setup } from 'xstate'
import type { Snapshot } from 'xstate'
import { captureUuid, decodeCheckpoint, decodeIntake, sameIntake } from '../../capture/intake.js'
import type {
	AdmissionCapability,
	AdmissionInput,
	AdmissionResult,
	AdmissionStageResult,
	IntakeCheckpoint
} from '../../contracts/intake.js'
import type { SyncReceipt } from '../../contracts/storage.js'

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing capture admission resource')
	return value
}
type Context = {
	request: AdmissionInput | undefined
	checkpoint: IntakeCheckpoint | undefined
	intakeId: string
	closing: boolean
	receipts: SyncReceipt[]
	result: AdmissionResult | undefined
}
/** Admission stops at local durability. It never starts network or document publication. */
export function createAdmissionMachine<S extends Snapshot<AdmissionStageResult>>(
	capability: AdmissionCapability<S>
) {
	const actors = {
		validate: fromPromise(async ({ input }: { input: AdmissionInput }) => {
			if (!capability.isCurrent()) throw new Error('Capture scope expired')
			return {
				intake: decodeIntake(input.intake, capability.libraryId),
				attemptId: captureUuid(input.attemptId)
			}
		}),
		load: fromPromise(({ input }: { input: string }) => capability.journal.get(input)),
		create: fromPromise(({ input }: { input: IntakeCheckpoint }) =>
			capability.journal.create(input)
		),
		barrier: fromPromise(({ input }: { input: IntakeCheckpoint }) =>
			capability.journal.advance(input, 'issuing')
		),
		settle: fromPromise(({ input }: { input: IntakeCheckpoint }) =>
			capability.journal.advance(input, 'admitted')
		),
		read: fromPromise(({ input }: { input: string }) => capability.read(input)),
		insert: capability.insert
	}
	const model = setup<
		Context,
		{ type: 'SHUTDOWN' },
		typeof actors,
		{},
		{ shutdown: undefined },
		{ stale: undefined; closing: undefined },
		never,
		string,
		AdmissionInput,
		AdmissionResult
	>({
		actors,
		guards: { stale: () => !capability.isCurrent(), closing: ({ context }) => context.closing },
		actions: {
			shutdown: enqueueActions(({ self, enqueue }) => {
				enqueue.assign({ closing: true })
				if (self.getSnapshot().children['insert']) enqueue.sendTo('insert', { type: 'SHUTDOWN' })
			})
		}
	})
	const interrupts = [
		{ guard: 'stale' as const, target: 'scopeChanged' },
		{ guard: 'closing' as const, target: 'interrupted' }
	]
	const checkpoint = ({ context }: { context: Context }) => required(context.checkpoint)
	const id = ({ context }: { context: Context }) => context.intakeId
	const finish = (kind: Exclude<AdmissionResult['kind'], 'admitted'>) =>
		model.createStateConfig({
			type: 'final',
			entry: assign({
				result: ({ context }) => ({ kind, intakeId: context.intakeId }),
				request: undefined,
				checkpoint: undefined,
				receipts: []
			})
		})
	return model.createMachine({
		id: 'capture-admission',
		initial: 'validating',
		context: ({ input }) => ({
			request: input,
			checkpoint: undefined,
			intakeId: input.intake.id,
			closing: false,
			receipts: [],
			result: undefined
		}),
		on: { SHUTDOWN: { actions: 'shutdown' } },
		output: ({ context }) => required(context.result),
		states: {
			validating: {
				invoke: {
					src: 'validate',
					input: ({ context }) => required(context.request),
					onDone: [
						...interrupts,
						{ target: 'loading', actions: assign({ request: ({ event }) => event.output }) }
					],
					onError: [{ guard: 'stale', target: 'scopeChanged' }, { target: 'failed' }]
				}
			},
			loading: {
				invoke: {
					src: 'load',
					input: id,
					onDone: [
						...interrupts,
						{ guard: ({ event }) => event.output === null, target: 'creating' },
						{
							guard: ({ context, event }) =>
								!!event.output && sameIntake(event.output.intake, required(context.request).intake),
							target: 'classifying',
							actions: assign({ checkpoint: ({ event }) => event.output ?? undefined })
						},
						{ target: 'blocked' }
					],
					onError: [...interrupts, { target: 'failed' }]
				}
			},
			creating: {
				invoke: {
					src: 'create',
					input: ({ context }) =>
						decodeCheckpoint(
							{
								formatVersion: '1',
								intake: required(context.request).intake,
								attemptId: required(context.request).attemptId,
								revision: 0,
								phase: 'pending'
							},
							capability.libraryId
						),
					onDone: [...interrupts, { target: 'loading' }],
					onError: [...interrupts, { target: 'failed' }]
				}
			},
			classifying: {
				always: [
					...interrupts,
					{
						guard: ({ context }) => required(context.checkpoint).phase === 'pending',
						target: 'recordingBarrier'
					},
					{ target: 'reconciling' }
				]
			},
			recordingBarrier: {
				invoke: {
					src: 'barrier',
					input: checkpoint,
					onDone: [
						...interrupts,
						{ guard: ({ event }) => event.output === null, target: 'loading' },
						{
							target: 'inserting',
							actions: assign({ checkpoint: ({ event }) => event.output ?? undefined })
						}
					],
					onError: [...interrupts, { target: 'uncertain' }]
				}
			},
			inserting: {
				invoke: {
					id: 'insert',
					src: 'insert',
					input: ({ context }) => {
						const draft = required(context.request).intake
						return {
							attempt: {
								operationId: draft.id,
								workspaceId: draft.id,
								membershipId: draft.id,
								draft
							}
						}
					},
					onDone: [
						{
							guard: ({ event }) => !event.output || event.output.settlement.kind === 'unresolved',
							target: 'uncertain'
						},
						{ guard: 'stale', target: 'scopeChanged' },
						{
							guard: ({ event }) => event.output?.settlement.kind === 'locallyPersisted',
							target: 'settling',
							actions: assign({
								receipts: ({ event }) =>
									event.output?.settlement.kind === 'locallyPersisted'
										? [event.output.settlement.workspace]
										: []
							})
						},
						{ guard: 'closing', target: 'interrupted' },
						{ guard: ({ event }) => event.output?.outcome === 'blocked', target: 'reconciling' },
						// Keep the barrier even for a known pre-commit failure; recovery never guesses.
						{ target: 'uncertain' }
					],
					onError: { target: 'uncertain' }
				}
			},
			reconciling: {
				invoke: {
					src: 'read',
					input: id,
					onDone: [
						...interrupts,
						{ guard: ({ event }) => event.output === null, target: 'uncertain' },
						{
							guard: ({ context, event }) =>
								!!event.output && sameIntake(event.output, required(context.request).intake),
							target: 'reconciled'
						},
						{ target: 'blocked' }
					],
					onError: [...interrupts, { target: 'uncertain' }]
				}
			},
			reconciled: {
				always: [
					...interrupts,
					{
						guard: ({ context }) => required(context.checkpoint).phase === 'admitted',
						target: 'admitted'
					},
					// A local-first row can still be optimistic; it is not a durability receipt.
					{ target: 'uncertain' }
				]
			},
			settling: {
				invoke: {
					src: 'settle',
					input: checkpoint,
					onDone: [
						...interrupts,
						{ guard: ({ event }) => event.output === null, target: 'uncertain' },
						{ target: 'admitted' }
					],
					onError: [...interrupts, { target: 'uncertain' }]
				}
			},
			admitted: {
				type: 'final',
				entry: assign({
					result: ({ context }) => ({
						kind: 'admitted',
						intakeId: context.intakeId,
						receipts: context.receipts
					}),
					request: undefined,
					checkpoint: undefined,
					receipts: []
				})
			},
			failed: finish('failed'),
			uncertain: finish('uncertain'),
			blocked: finish('blocked'),
			interrupted: finish('interrupted'),
			scopeChanged: finish('scopeChanged')
		}
	})
}
