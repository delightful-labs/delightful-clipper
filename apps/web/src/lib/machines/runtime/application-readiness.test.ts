import {
	createSessionAcquisitionMachine,
	selectAcquiredSession
} from 'delightful-local-first/session/workflow'
import { createActor, waitFor } from 'xstate'
import { describe, expect, it, vi } from 'vitest'
import { createApplicationReadinessMachine } from './application-readiness.js'
import type {
	AccountHost,
	AccountInput,
	AccountObservation,
	RootAccess
} from '../../contracts/account.js'

const applicationReadinessMachine = createApplicationReadinessMachine<AccountHost>()
function startup(open: () => Promise<AccountHost>) {
	const binding = {}
	const owner = createActor(createSessionAcquisitionMachine<AccountHost>(), {
		input: { binding, capability: { open } }
	}).start()
	const attach = (): AccountInput<AccountHost> => ({
		startup: { owner, scope: { binding, attachment: {}, generation: 0 } },
		bind: (host) => host
	})
	return { owner, attach }
}
function input(host: AccountHost) {
	return startup(async () => host).attach()
}

function fixture(initial: AccountObservation) {
	let observation = initial
	const listeners = new Set<() => void>()
	const binding = {}
	const host: AccountHost = {
		read: () => observation,
		readiness: {
			binding: {},
			capability: {
				readStatus: () => observation.status,
				subscribe: (notify) => {
					listeners.add(notify)
					return () => {
						listeners.delete(notify)
					}
				},
				retry: vi.fn(async () => {})
			}
		},
		create: vi.fn(async () => {}),
		logout: vi.fn(async () => {}),
		release: vi.fn(() => {}),
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
			for (const notify of listeners) notify()
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
	it('reuses DLF-owned late acquisition after releasing the first attachment', async () => {
		const opening = Promise.withResolvers<AccountHost>()
		const { host } = fixture({ status: 'signed-out' })
		const open = vi.fn(() => opening.promise)
		const { owner, attach } = startup(open)
		const actor = createActor(applicationReadinessMachine, { input: attach() }).start()
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		opening.resolve(host)
		await waitFor(owner, (snapshot) => selectAcquiredSession(snapshot) === host)
		expect(host.release).not.toHaveBeenCalled()
		const next = createActor(applicationReadinessMachine, { input: attach() }).start()
		await waitFor(next, (snapshot) => snapshot.matches({ running: 'signedOut' }))
		expect(open).toHaveBeenCalledOnce()
		next.send({ type: 'SHUTDOWN' })
		await waitFor(next, (snapshot) => snapshot.status === 'done')
		expect(host.release).toHaveBeenCalledOnce()
		expect(next.getSnapshot().context.host).toBeUndefined()
		owner.stop()
	})
	it('does not call a locally pending root saved or synced', async () => {
		const local = Promise.withResolvers<void>(),
			global = Promise.withResolvers<void>()
		const { host } = fixture(ready('owner', root(local.promise, global.promise)))
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
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
	it('drains a pending root write before releasing the DLF attachment', async () => {
		const local = Promise.withResolvers<void>()
		const { host } = fixture(ready('owner', root(local.promise, Promise.resolve())))
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
		await waitFor(actor, (snapshot) => snapshot.matches({ running: { library: 'local' } }))
		actor.send({ type: 'SHUTDOWN' })
		expect(host.release).not.toHaveBeenCalled()
		local.resolve()
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(host.release).toHaveBeenCalledOnce()
	})
	it('does not publish an old binding after account replacement', async () => {
		const first = Promise.withResolvers<void>()
		const initial = ready('first', root(first.promise, Promise.resolve()))
		const next = ready('second', root(Promise.resolve(), Promise.resolve()))
		const { host, emit } = fixture(initial)
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
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
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
		await waitFor(actor, (snapshot) => snapshot.matches({ running: { library: 'conflict' } }))
		expect(ensure).not.toHaveBeenCalled()
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
	})
	it('uses DLF validation and clears an invalid restoration phrase without mutation', async () => {
		const { host } = fixture({ status: 'signed-out' })
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
		await waitFor(actor, (snapshot) => snapshot.matches({ running: 'signedOut' }))
		actor.send({ type: 'RESTORE', phrase: 'invalid synthetic phrase' })
		await waitFor(actor, (snapshot) => snapshot.context.feedback === 'restoreInvalid')
		expect(actor.getSnapshot().context.phrase).toBe('')
		expect(host.restoration.capability.restoreIdentity).not.toHaveBeenCalled()
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
	})
	it('retries failed acquisition through the same DLF owner', async () => {
		const { host } = fixture({ status: 'signed-out' })
		const open = vi
			.fn(async () => host)
			.mockRejectedValueOnce(new Error('Synthetic acquisition failure'))
		const { owner, attach } = startup(open)
		const actor = createActor(applicationReadinessMachine, { input: attach() }).start()
		await waitFor(actor, (snapshot) => snapshot.matches('openFailed'))
		actor.send({ type: 'RETRY' })
		await waitFor(actor, (snapshot) => snapshot.matches({ running: 'signedOut' }))
		expect(open).toHaveBeenCalledTimes(2)
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		owner.stop()
	})
	it('lets DLF drain an issued SDK retry before releasing the attachment', async () => {
		const pending = Promise.withResolvers<void>()
		const { host } = fixture({ status: 'error' })
		const retry = vi.fn(() => pending.promise)
		const bound = {
			...host,
			readiness: { ...host.readiness, capability: { ...host.readiness.capability, retry } }
		}
		const actor = createActor(applicationReadinessMachine, { input: input(bound) }).start()
		await waitFor(actor, (snapshot) => snapshot.matches({ running: 'unavailable' }))
		actor.send({ type: 'RETRY' })
		actor.send({ type: 'RETRY' })
		actor.send({ type: 'SHUTDOWN' })
		expect(retry).toHaveBeenCalledOnce()
		expect(host.release).not.toHaveBeenCalled()
		pending.resolve()
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(host.release).toHaveBeenCalledOnce()
	})
	it('reobserves subscription failure through DLF without retrying the SDK', async () => {
		const { host } = fixture({ status: 'signed-out' })
		const subscribe = vi.fn(host.readiness.capability.subscribe).mockImplementationOnce(() => {
			throw new Error('Synthetic observer failure')
		})
		const bound = {
			...host,
			readiness: { ...host.readiness, capability: { ...host.readiness.capability, subscribe } }
		}
		const actor = createActor(applicationReadinessMachine, { input: input(bound) }).start()
		await waitFor(actor, (snapshot) => snapshot.matches({ running: 'unavailable' }))
		actor.send({ type: 'RETRY' })
		await waitFor(actor, (snapshot) => snapshot.matches({ running: 'signedOut' }))
		expect(subscribe).toHaveBeenCalledTimes(2)
		expect(host.readiness.capability.retry).not.toHaveBeenCalled()
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
	})
})
