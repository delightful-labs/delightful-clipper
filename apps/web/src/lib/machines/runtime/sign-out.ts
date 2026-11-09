import { fromPromise, setup } from 'xstate'
import type { AccountHost } from '../../contracts/account.js'

// The application drains the library before invoking this child and retains it
// through shutdown. Clearing the provider cookie precedes the native Jazz logout.
const actors = {
	provider: fromPromise(
		({ input }: { input: AccountHost }) => input.signOut?.() ?? Promise.resolve()
	),
	session: fromPromise(({ input }: { input: AccountHost }) => input.logout())
}
export const signOutMachine = setup<
	AccountHost,
	{ type: 'UNUSED' },
	typeof actors,
	{},
	{},
	{},
	never,
	string,
	AccountHost
>({ actors }).createMachine({
	id: 'sign-out',
	context: ({ input }) => input,
	initial: 'provider',
	states: {
		provider: { invoke: { src: 'provider', input: ({ context }) => context, onDone: 'session' } },
		session: { invoke: { src: 'session', input: ({ context }) => context, onDone: 'done' } },
		done: { type: 'final' }
	}
})
