import { createActor, toPromise } from 'xstate'
import { expect, it, vi } from 'vitest'
import { signOutMachine, signOutInput } from './sign-out.js'
import type { AccountHost } from '../../contracts/account.js'

function fixture(signOut: () => Promise<void>) {
	const logout = vi.fn(async () => {})
	const input: AccountHost = {
		signOut,
		logout,
		read: () => ({ status: 'signed-out' }),
		create: logout,
		release: () => {},
		readiness: {
			binding: {},
			capability: { readStatus: () => 'signed-out', subscribe: () => () => {}, retry: logout }
		},
		restoration: {
			binding: {},
			capability: {
				parsePhrase: async () => '',
				isCurrentBinding: () => false,
				restoreIdentity: logout,
				readIdentity: async () => ({ kind: 'unavailable' })
			}
		}
	}
	return {
		logout,
		actor: createActor(signOutMachine, { input: signOutInput(input, input.read()) })
	}
}
it('waits for provider cookie clearance before native Jazz logout', async () => {
	const cleared = Promise.withResolvers<void>()
	const f = fixture(() => cleared.promise)
	const done = toPromise(f.actor.start())
	expect(f.logout).not.toHaveBeenCalled()
	cleared.resolve()
	await done
	expect(f.logout).toHaveBeenCalledOnce()
})
it('does not log Jazz out after a provider sign-out failure', async () => {
	const f = fixture(async () => {
		throw new Error('Provider unavailable')
	})
	f.actor.subscribe({ error: () => {} })
	expect(await toPromise(f.actor.start())).toEqual({ outcome: 'failed', stage: 'provider' })
	expect(f.logout).not.toHaveBeenCalled()
})
