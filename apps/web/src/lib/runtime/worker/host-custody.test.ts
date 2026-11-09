import { waitFor } from 'xstate'
import { expect, it, vi } from 'vitest'
import { fixture } from './host-machine.test-support.js'
import { retainDetachedTransaction } from '../../backend/jazz/transaction.js'

// Custody is intentionally retained for this worker realm's entire lifetime.
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
