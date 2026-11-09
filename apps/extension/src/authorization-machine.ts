import type { EventPayload } from '../../web/src/lib/machines/events.js'
import { types, createCallbackLogic, setup } from 'xstate'

import type { RuntimeSnapshot } from './runtime-machine.js'
import type { Authorization } from './connection.js'
export type AccountAccess =
	| { kind: 'waiting' | 'signed-out' | 'unavailable' }
	| { kind: 'ready'; accountId: string }
export function selectAccountAccess(snapshot: RuntimeSnapshot): AccountAccess {
	if (
		snapshot.matches('reloading') ||
		snapshot.matches({ job: 'restarting' }) ||
		snapshot.matches({ job: 'draining' })
	)
		return { kind: 'waiting' }
	const accountId = snapshot.context.library?.getSnapshot().context.capability?.libraryId
	if (accountId) return { kind: 'ready', accountId }
	if (snapshot.context.accountStatus === 'signedOut') return { kind: 'signed-out' }
	if (snapshot.context.accountMessage?.variant === 'error') return { kind: 'unavailable' }
	return { kind: 'waiting' }
}
type Event = { type: 'ACCOUNT'; value: AccountAccess }
/** Read-only admission. No credentials or article writes are acquired by this actor. */
export function createAuthorizationMachine(
	watch: (notify: (value: AccountAccess) => void) => () => void
) {
	const actors = {
		account: createCallbackLogic(({ sendBack }) =>
			watch((value) => sendBack({ type: 'ACCOUNT', value }))
		)
	}
	return setup({
		schemas: {
			context: types<{ expected: string; status: Authorization }>(),
			events: { ACCOUNT: types<EventPayload<Event, 'ACCOUNT'>>() },
			input: types<{ expected: string }>(),
			output: types<{ status: Authorization }>(),
			tags: types<string>(),
			children: { account: types<import('xstate').ActorRefFrom<(typeof actors)['account']>>() }
		},
		actors
	}).createMachine({
		initial: 'waiting',
		context: ({ input }) => ({ ...input, status: 'unavailable' }),
		invoke: { id: 'account', src: 'account' },
		output: ({ context }) => ({ status: context.status }),
		states: {
			waiting: {
				after: { 15000: { target: 'unavailable' } },
				on: {
					ACCOUNT: (args) => {
						const { event } = args
						if (event.value.kind === 'waiting') {
							return {}
						}
						if (event.value.kind === 'ready' && event.value.accountId === args.context.expected) {
							return { target: 'connected' }
						}
						if (event.value.kind === 'signed-out' || event.value.kind === 'ready') {
							return { target: 'signedOut' }
						}
						if (event.value.kind === 'unavailable') {
							return { target: 'unavailable' }
						}
					}
				}
			},
			connected: {
				type: 'final',
				entry: () => {
					return { context: { status: 'connected' } }
				}
			},
			signedOut: {
				type: 'final',
				entry: () => {
					return { context: { status: 'signed-out' } }
				}
			},
			unavailable: { type: 'final' }
		}
	})
}
