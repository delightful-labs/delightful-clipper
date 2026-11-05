import { assign, fromCallback, setup } from 'xstate'
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
		account: fromCallback(({ sendBack }) => watch((value) => sendBack({ type: 'ACCOUNT', value })))
	}
	return setup<
		{ expected: string; status: Authorization },
		Event,
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		{ expected: string },
		{ status: Authorization }
	>({ actors }).createMachine({
		initial: 'waiting',
		context: ({ input }) => ({ ...input, status: 'unavailable' }),
		invoke: { src: 'account' },
		output: ({ context }) => ({ status: context.status }),
		states: {
			waiting: {
				after: { 15000: 'unavailable' },
				on: {
					ACCOUNT: [
						{ guard: ({ event }) => event.value.kind === 'waiting' },
						{
							guard: ({ context, event }) =>
								event.value.kind === 'ready' && event.value.accountId === context.expected,
							target: 'connected'
						},
						{
							guard: ({ event }) =>
								event.value.kind === 'signed-out' || event.value.kind === 'ready',
							target: 'signedOut'
						},
						{ guard: ({ event }) => event.value.kind === 'unavailable', target: 'unavailable' }
					]
				}
			},
			connected: { type: 'final', entry: assign({ status: 'connected' }) },
			signedOut: { type: 'final', entry: assign({ status: 'signed-out' }) },
			unavailable: { type: 'final' }
		}
	})
}
