import { assign, fromPromise, setup } from 'xstate'
import type { WorkflowMessage } from '../../web/src/lib/contracts/feedback.js'
import type { ApplicationSnapshot } from '../../web/src/lib/machines/runtime/application-readiness.js'
import {
	selectApplicationView,
	selectLibraryActor
} from '../../web/src/lib/machines/runtime/application-readiness.js'
import { t } from '../../web/src/lib/localization/index.js'
export type ConnectionObservation =
	| { kind: 'restoring' | 'waiting' | 'signed-out' }
	| { kind: 'ready'; accountId: string }
	| { kind: 'failed' }
/** Projection of the existing account owner; it carries no credentials or account objects. */
export function connectionObservation<Session extends object>(
	snapshot: ApplicationSnapshot<Session>
): ConnectionObservation {
	if (snapshot.matches({ active: { flow: { running: 'restoring' } } })) return { kind: 'restoring' }
	if (
		snapshot.context.feedback === 'restoreFailed' ||
		snapshot.context.feedback === 'restoreInvalid'
	)
		return { kind: 'failed' }
	const library = selectLibraryActor(snapshot)
	const accountId = library?.getSnapshot().context.capability?.libraryId
	if (accountId) return { kind: 'ready', accountId }
	if (snapshot.context.observation.status === 'signed-out') return { kind: 'signed-out' }
	return { kind: 'waiting' }
}
type Context = {
	observation: ConnectionObservation
	accountId: string | undefined
	message: WorkflowMessage | undefined
}
type Event =
	| { type: 'OBSERVED'; observation: ConnectionObservation }
	| { type: 'RESTORE'; phrase: string }
	| { type: 'RETRY' | 'SHUTDOWN' }
export function createSignInMachine(cap: {
	connect: (accountId: string) => Promise<void>
	connected: () => void
	restore?: { can: () => boolean; send: (phrase: string) => void }
}) {
	const actors = { connect: fromPromise(({ input }: { input: string }) => cap.connect(input)) }
	const model = setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{ restorable: undefined },
		never,
		string
	>({
		actors,
		guards: { restorable: () => cap.restore?.can() ?? false }
	})
	const restore = {
		guard: 'restorable' as const,
		actions: model.createAction(({ event }) => {
			if (event.type === 'RESTORE') cap.restore?.send(event.phrase)
		})
	}
	return model.createMachine({
		initial: 'idle',
		context: { observation: { kind: 'waiting' }, accountId: undefined, message: undefined },
		on: {
			OBSERVED: { actions: assign({ observation: ({ event }) => event.observation }) },
			SHUTDOWN: '.closed'
		},
		states: {
			idle: {
				always: {
					guard: ({ context }) => context.observation.kind === 'restoring',
					target: 'restoring'
				},
				on: { RESTORE: restore }
			},
			restoring: {
				entry: assign({ message: undefined }),
				always: [
					{ guard: ({ context }) => context.observation.kind === 'failed', target: 'idle' },
					{
						guard: ({ context }) => context.observation.kind === 'ready',
						target: 'confirming',
						actions: assign({
							accountId: ({ context }) =>
								context.observation.kind === 'ready' ? context.observation.accountId : undefined
						})
					}
				]
			},
			confirming: {
				tags: 'confirming',
				entry: assign({
					message: () => ({ text: t('account.status.working'), variant: 'info' as const })
				}),
				invoke: {
					src: 'connect',
					input: ({ context }) => context.accountId!,
					onDone: [
						{
							guard: ({ context }) =>
								context.observation.kind === 'ready' &&
								context.observation.accountId === context.accountId,
							target: 'connected'
						},
						{ target: 'idle' }
					],
					onError: 'failed'
				}
			},
			connected: {
				entry: [assign({ message: undefined }), () => cap.connected()],
				always: {
					guard: ({ context }) => context.observation.kind === 'restoring',
					target: 'restoring'
				},
				on: { RESTORE: restore }
			},
			failed: {
				entry: assign({
					message: () => ({ text: t('account.feedback.identityFailed'), variant: 'error' as const })
				}),
				on: {
					RESTORE: restore,
					RETRY: {
						guard: ({ context }) =>
							context.observation.kind === 'ready' &&
							context.observation.accountId === context.accountId,
						target: 'confirming'
					}
				},
				always: {
					guard: ({ context }) => context.observation.kind === 'restoring',
					target: 'restoring'
				}
			},
			closed: {
				type: 'final',
				entry: assign({
					observation: { kind: 'waiting' },
					accountId: undefined,
					message: undefined
				})
			}
		}
	})
}
export function signInView<Session extends object>(
	account: ApplicationSnapshot<Session> | undefined,
	confirmation: { context: Context; hasTag: (tag: 'confirming') => boolean }
) {
	const view = selectApplicationView(account, true)
	return {
		message:
			confirmation.context.message ??
			view.feedbackMessage ??
			(view.canRestore ? undefined : view.message)
	}
}
