import { assign, enqueueActions, fromPromise, setup } from 'xstate'
import type { Snapshot } from 'xstate'
import { captureUuid, decodeIntake, sameIntake } from '../../capture/intake.js'
import type {
	AdmissionCapability,
	AdmissionInput,
	AdmissionResult,
	AdmissionStageResult
} from '../../contracts/intake.js'

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing capture admission resource')
	return value
}
type Context = {
	request: AdmissionInput | undefined
	intakeId: string
	closing: boolean
	result: AdmissionResult | undefined
}
/** Jazz owns persistence. Recovery observes existing evidence and cannot issue an insert. */
export function createAdmissionMachine<S extends Snapshot<AdmissionStageResult>>(
	capability: AdmissionCapability<S>
) {
	const actors = {
		validate: fromPromise(async ({ input }: { input: AdmissionInput }): Promise<AdmissionInput> => {
			if (!capability.isCurrent()) throw new Error('Capture scope expired')
			if (input.kind === 'recover')
				return { kind: 'recover', intakeId: captureUuid(input.intakeId) }
			if (input.kind !== 'new') throw new Error('Invalid capture admission request')
			return { kind: 'new', intake: decodeIntake(input.intake, capability.libraryId) }
		}),
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
	const finish = (kind: Exclude<AdmissionResult['kind'], 'admitted' | 'recovered'>) =>
		model.createStateConfig({
			type: 'final',
			entry: assign({
				result: ({ context }) => ({ kind, intakeId: context.intakeId }),
				request: undefined
			})
		})
	return model.createMachine({
		id: 'capture-admission',
		initial: 'validating',
		context: ({ input }) => ({
			request: input,
			intakeId: input.kind === 'new' ? input.intake.id : input.intakeId,
			closing: false,
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
						{ target: 'routing', actions: assign({ request: ({ event }) => event.output }) }
					],
					onError: [...interrupts, { target: 'failed' }]
				}
			},
			routing: {
				always: [
					...interrupts,
					{ guard: ({ context }) => context.request?.kind === 'new', target: 'inserting' },
					{ target: 'recovering' }
				]
			},
			inserting: {
				invoke: {
					id: 'insert',
					src: 'insert',
					input: ({ context }) => {
						const request = required(context.request)
						if (request.kind !== 'new') throw new Error('Recovery cannot insert a capture')
						const draft = request.intake
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
						...interrupts,
						{
							guard: ({ event }) => event.output?.settlement.kind === 'locallyPersisted',
							target: 'admitted',
							actions: assign({
								result: ({ context, event }) => {
									if (event.output?.settlement.kind !== 'locallyPersisted')
										throw new Error('Missing local capture receipt')
									return {
										kind: 'admitted',
										intakeId: context.intakeId,
										receipts: [event.output.settlement.workspace]
									}
								}
							})
						},
						{ guard: ({ event }) => event.output?.outcome === 'blocked', target: 'recovering' },
						{ target: 'failed' }
					],
					onError: { target: 'uncertain' }
				}
			},
			recovering: {
				invoke: {
					src: 'read',
					input: ({ context }) => context.intakeId,
					onDone: [
						...interrupts,
						{ guard: ({ event }) => event.output === null, target: 'uncertain' },
						{
							guard: ({ context, event }) =>
								context.request?.kind === 'new' &&
								!!event.output &&
								!sameIntake(context.request.intake, event.output),
							target: 'blocked'
						},
						{
							target: 'recovered',
							actions: assign({
								result: ({ event }) => {
									if (!event.output) throw new Error('Missing capture evidence')
									// A local-first read can be optimistic; no write or sync receipt is invented.
									return { kind: 'recovered', intake: event.output }
								}
							})
						}
					],
					onError: [...interrupts, { target: 'uncertain' }]
				}
			},
			admitted: { type: 'final', entry: assign({ request: undefined }) },
			recovered: { type: 'final', entry: assign({ request: undefined }) },
			failed: finish('failed'),
			uncertain: finish('uncertain'),
			blocked: finish('blocked'),
			interrupted: finish('interrupted'),
			scopeChanged: finish('scopeChanged')
		}
	})
}
