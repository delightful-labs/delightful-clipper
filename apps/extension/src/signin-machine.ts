import type { EventPayload } from '../../web/src/lib/machines/events.js'
import { types, setup, createAsyncLogic } from 'xstate'

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
		snapshot.matches({ active: { feedback: 'restoreFailed' } }) ||
		snapshot.matches({ active: { feedback: 'restoreInvalid' } })
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
	const actors = {
		connect: createAsyncLogic({ run: ({ input }: { input: string }) => cap.connect(input) })
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				OBSERVED: types<EventPayload<Event, 'OBSERVED'>>(),
				RESTORE: types<EventPayload<Event, 'RESTORE'>>(),
				RETRY: types<EventPayload<Event, 'RETRY'>>(),
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
			},
			tags: types<string>(),
			children: { connect: types<import('xstate').ActorRefFrom<(typeof actors)['connect']>>() }
		},
		actors,
		guards: { restorable: () => cap.restore?.can() ?? false }
	})
	const restore = (
		{
			event,
			guards
		}: { event: Extract<Event, { type: 'RESTORE' }>; guards: { restorable: () => boolean } },
		enqueue: (effect: () => void) => void
	) => {
		if (!guards.restorable()) return
		enqueue(() => cap.restore?.send(event.phrase))
	}

	return model.createMachine({
		initial: 'idle',
		context: {
			observation: { kind: 'waiting' },
			accountId: undefined,
			message: undefined
		},
		on: {
			OBSERVED: (args) => {
				return { context: { observation: args.event.observation } }
			},
			SHUTDOWN: { target: '.closed' }
		},
		states: {
			idle: {
				always: (args) => {
					if (!(args.context.observation.kind === 'restoring')) return
					return { target: 'restoring' }
				},
				on: { RESTORE: restore }
			},
			restoring: {
				entry: () => {
					return { context: { message: undefined } }
				},
				always: (args) => {
					const { context } = args
					if (context.observation.kind === 'failed') {
						return { target: 'idle' }
					}
					if (context.observation.kind === 'ready') {
						return {
							target: 'confirming',
							context: {
								accountId:
									context.observation.kind === 'ready' ? context.observation.accountId : undefined
							}
						}
					}
				}
			},
			confirming: {
				tags: ['confirming'],
				entry: () => {
					return {
						context: { message: { text: t('account.status.working'), variant: 'info' } }
					}
				},
				invoke: {
					id: 'connect',
					src: 'connect',
					input: ({ context }: { context: Context }) => context.accountId!,
					onDone: (args) => {
						const { context } = args
						if (
							context.observation.kind === 'ready' &&
							context.observation.accountId === context.accountId
						) {
							return { target: 'connected' }
						}
						return { target: 'idle' }
					},
					onError: { target: 'failed' }
				}
			},
			connected: {
				entry: (args, enq) => {
					enq(() => cap.connected())
					return { context: { message: undefined } }
				},
				always: (args) => {
					if (!(args.context.observation.kind === 'restoring')) return
					return { target: 'restoring' }
				},
				on: { RESTORE: restore }
			},
			failed: {
				entry: () => {
					return {
						context: {
							message: { text: t('account.feedback.identityFailed'), variant: 'error' }
						}
					}
				},
				on: {
					RESTORE: restore,
					RETRY: (args) => {
						const { context } = args
						if (
							!(
								context.observation.kind === 'ready' &&
								context.observation.accountId === context.accountId
							)
						)
							return
						return { target: 'confirming' }
					}
				},
				always: (args) => {
					if (!(args.context.observation.kind === 'restoring')) return
					return { target: 'restoring' }
				}
			},
			closed: {
				type: 'final',
				entry: () => {
					return {
						context: {
							observation: { kind: 'waiting' },
							accountId: undefined,
							message: undefined
						}
					}
				}
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
