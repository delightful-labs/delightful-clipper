import { createAsyncLogic, setup, types, type ActorRefFrom } from 'xstate'
import type { AccountHost } from '../../contracts/account.js'

// The application drains the library before invoking this child and retains it
// through shutdown. Clearing the provider cookie precedes the native Jazz logout.
const actors = {
	provider: createAsyncLogic({
		run: ({ input }: { input: AccountHost }) => input.signOut?.() ?? Promise.resolve()
	}),
	session: createAsyncLogic({ run: ({ input }: { input: AccountHost }) => input.logout() })
}
export const signOutMachine = setup({
	schemas: {
		context: types<AccountHost>(),
		input: types<AccountHost>(),
		events: { UNUSED: types<{}>() },
		children: {
			provider: types<ActorRefFrom<typeof actors.provider>>(),
			session: types<ActorRefFrom<typeof actors.session>>()
		}
	},
	actors
}).createMachine({
	id: 'sign-out',
	context: ({ input }) => input,
	initial: 'provider',
	states: {
		provider: {
			invoke: {
				id: 'provider',
				src: 'provider',
				input: ({ context }) => context,
				onDone: { target: 'session' }
			}
		},
		session: {
			invoke: {
				id: 'session',
				src: 'session',
				input: ({ context }) => context,
				onDone: { target: 'done' }
			}
		},
		done: { type: 'final' }
	}
})
