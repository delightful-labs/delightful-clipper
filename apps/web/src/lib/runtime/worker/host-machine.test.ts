import { bindWorkerConnectivity } from '../../offline/connectivity.js'
import { createActor, waitFor } from 'xstate'
import { expect, it, vi } from 'vitest'
import { createSessionAcquisitionMachine } from 'delightful-local-first/session/workflow'
import type { Session } from '../../backend/jazz/account.js'
import type { AccountInput } from '../../contracts/account.js'
import { retainDetachedTransaction } from '../../backend/jazz/transaction.js'
import { workerHostMachine } from './host-machine.js'

function fixture() {
	bindWorkerConnectivity(true)
	const unused = vi.fn(async () => {})
	const close = vi.fn(async () => {})
	const session: Session = {
		getSnapshot: () => ({ status: 'signed-out' }),
		subscribe: () => () => {},
		createLocalFirst: unused,
		restoreLocalFirst: unused,
		loginWithBackend: unused,
		linkWithBackend: unused,
		logout: unused,
		retry: unused,
		close
	}
	const binding = {}
	const owner = createActor(createSessionAcquisitionMachine<Session>(), {
		input: { binding, capability: { open: async () => session }, existing: session }
	}).start()
	const input: AccountInput<Session> = {
		startup: { owner, scope: { binding, attachment: {}, generation: 0 } },
		bind: () => ({
			read: () => ({ status: 'signed-out' }),
			readiness: {
				binding: {},
				capability: {
					readStatus: () => 'signed-out',
					subscribe: () => () => {},
					retry: unused
				}
			},
			create: unused,
			logout: unused,
			release: () => {},
			restoration: {
				binding: {},
				capability: {
					parsePhrase: async () => {
						throw new Error('Unused fixture restoration')
					},
					isCurrentBinding: () => false,
					restoreIdentity: unused,
					readIdentity: async () => ({ kind: 'unavailable' })
				}
			}
		})
	}
	return {
		close,
		owner,
		actor: createActor(workerHostMachine, { input: { ...input, scope: 'test-scope' } })
	}
}

it('closes the SDK only after the application has acknowledged clean shutdown', async () => {
	const f = fixture()
	try {
		f.actor.start()
		f.actor.send({ type: 'SHUTDOWN' })
		await waitFor(f.actor, (snapshot) => snapshot.status === 'done' || snapshot.matches('failed'), {
			timeout: 1000
		})
		expect(f.actor.getSnapshot().value).toBe('closed')
		expect(f.close).toHaveBeenCalledOnce()
	} finally {
		f.actor.stop()
		f.owner.stop()
	}
})

it('retains detached native custody and refuses a safe-close acknowledgment', async () => {
	const f = fixture()
	const pending = Promise.withResolvers<void>()
	const rollback = vi.fn(async () => true)
	retainDetachedTransaction({
		acquisition: Promise.resolve({ tx: { rollback } }),
		pending: pending.promise,
		commit: undefined
	})
	try {
		f.actor.start()
		f.actor.send({ type: 'SHUTDOWN' })
		await waitFor(f.actor, (snapshot) => snapshot.matches('failed'), { timeout: 1000 })
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.close).not.toHaveBeenCalled()
		expect(rollback).not.toHaveBeenCalled()
	} finally {
		pending.resolve()
		f.actor.stop()
		f.owner.stop()
	}
})
