import { createActor, waitFor } from 'xstate'
import { describe, expect, it, vi } from 'vitest'
import { accountMachine } from './account.js'
import type { AccountHost, AccountObservation, RootAccess } from '../contracts/account.js'

function fixture(initial: AccountObservation) {
	let observation = initial
	const listeners = new Set<(value: AccountObservation) => void>()
	const binding = {}
	const host: AccountHost = {
		read: () => observation,
		subscribe: (notify) => {
			listeners.add(notify)
			notify(observation)
			return () => {
				listeners.delete(notify)
			}
		},
		create: vi.fn(async () => {}),
		logout: vi.fn(async () => {}),
		retry: vi.fn(async () => {}),
		close: vi.fn(async () => {}),
		restoration: {
			binding,
			capability: {
				parsePhrase: async () => {
					throw new Error('Invalid synthetic phrase')
				},
				isCurrentBinding: (candidate) => candidate === binding,
				restoreIdentity: vi.fn(async () => {}),
				readIdentity: async () => ({ kind: 'unavailable' })
			}
		}
	}
	return {
		host,
		emit(value: AccountObservation) {
			observation = value
			for (const notify of listeners) notify(value)
		}
	}
}
function ready(accountId: string, root: RootAccess): AccountObservation {
	return {
		status: 'ready',
		binding: {},
		accountId,
		root,
		recovery: {
			source: {
				subscribe: (notify) => {
					notify({ kind: 'unavailable' })
					return () => {}
				}
			},
			capability: { isCurrentScope: () => false, readPhrase: async () => '' }
		}
	}
}
function root(local: Promise<void>, global: Promise<void>): RootAccess {
	return {
		read: async () => 'compatible',
		ensure: () => ({ local: () => local, global: () => global })
	}
}

describe('account/root ownership', () => {
	it('retains a late acquisition through shutdown and closes it', async () => {
		const opening = Promise.withResolvers<AccountHost>()
		const { host } = fixture({ status: 'signed-out' })
		const actor = createActor(accountMachine, { input: { open: () => opening.promise } }).start()
		actor.send({ type: 'SHUTDOWN' })
		expect(host.close).not.toHaveBeenCalled()
		opening.resolve(host)
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(host.close).toHaveBeenCalledOnce()
		expect(actor.getSnapshot().context.host).toBeUndefined()
	})
	it('does not call a locally pending root saved or synced', async () => {
		const local = Promise.withResolvers<void>(),
			global = Promise.withResolvers<void>()
		const { host } = fixture(ready('owner', root(local.promise, global.promise)))
		const actor = createActor(accountMachine, { input: { open: async () => host } }).start()
		await waitFor(actor, (snapshot) => snapshot.matches({ running: { library: 'local' } }))
		expect(actor.getSnapshot().matches({ running: { library: 'ready' } })).toBe(false)
		local.resolve()
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ running: { library: { ready: 'syncPending' } } })
		)
		global.reject(new Error('Authority rejected'))
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ running: { library: { ready: 'syncFailed' } } })
		)
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
	})
	it('keeps acquisition ownership until a pending local write settles on shutdown', async () => {
		const local = Promise.withResolvers<void>()
		const { host } = fixture(ready('owner', root(local.promise, Promise.resolve())))
		const actor = createActor(accountMachine, { input: { open: async () => host } }).start()
		await waitFor(actor, (snapshot) => snapshot.matches({ running: { library: 'local' } }))
		actor.send({ type: 'SHUTDOWN' })
		expect(host.close).not.toHaveBeenCalled()
		local.resolve()
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(host.close).toHaveBeenCalledOnce()
	})
	it('does not publish an old binding after account replacement', async () => {
		const first = Promise.withResolvers<void>()
		const initial = ready('first', root(first.promise, Promise.resolve()))
		const next = ready('second', root(Promise.resolve(), Promise.resolve()))
		const { host, emit } = fixture(initial)
		const actor = createActor(accountMachine, { input: { open: async () => host } }).start()
		await waitFor(actor, (snapshot) => snapshot.matches({ running: { library: 'local' } }))
		emit(next)
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ running: { library: { ready: 'synced' } } })
		)
		first.resolve()
		await Promise.resolve()
		expect(actor.getSnapshot().context.observation).toBe(next)
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
	})
	it('does not overwrite an incompatible root', async () => {
		const ensure = vi.fn(() => ({ local: async () => {}, global: async () => {} }))
		const { host } = fixture(ready('owner', { read: async () => 'incompatible', ensure }))
		const actor = createActor(accountMachine, { input: { open: async () => host } }).start()
		await waitFor(actor, (snapshot) => snapshot.matches({ running: { library: 'conflict' } }))
		expect(ensure).not.toHaveBeenCalled()
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
	})
	it('uses DLF validation and clears an invalid restoration phrase without mutation', async () => {
		const { host } = fixture({ status: 'signed-out' })
		const actor = createActor(accountMachine, { input: { open: async () => host } }).start()
		await waitFor(actor, (snapshot) => snapshot.matches({ running: 'signedOut' }))
		actor.send({ type: 'RESTORE', phrase: 'invalid synthetic phrase' })
		await waitFor(actor, (snapshot) => snapshot.context.feedback === 'restoreInvalid')
		expect(actor.getSnapshot().context.phrase).toBe('')
		expect(host.restoration.capability.restoreIdentity).not.toHaveBeenCalled()
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
	})
})
