import { waitFor, SimulatedClock } from 'xstate'
import { expect, it, vi } from 'vitest'
import { createWorkerHostFixture as fixture } from './host-machine.test-support.js'

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

it('holds provider navigation until application drain and native SDK close settle', async () => {
	const nativeClose = Promise.withResolvers<void>()
	const f = fixture()
	f.close.mockImplementation(() => nativeClose.promise)
	const fetch = vi.fn(async () =>
		Response.json({ url: 'https://provider.example.invalid/authorize' })
	)
	vi.stubGlobal('fetch', fetch)
	try {
		f.actor.start()
		f.actor.send({ type: 'ATPROTO', scope: crypto.randomUUID(), handle: 'stale.example.invalid' })
		expect(fetch).not.toHaveBeenCalled()
		f.actor.send({
			type: 'ATPROTO',
			scope: f.actor.getSnapshot().context.scope,
			handle: 'derocher.me'
		})
		await waitFor(f.actor, (snapshot) => snapshot.matches('closingSession'))
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.actor.getSnapshot().context.redirect).toBe(
			'https://provider.example.invalid/authorize'
		)
		expect(f.close).toHaveBeenCalledOnce()
		nativeClose.resolve()
		await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
		expect(f.actor.getSnapshot().matches('closed')).toBe(true)
	} finally {
		nativeClose.resolve()
		f.actor.stop()
		f.owner.stop()
		vi.unstubAllGlobals()
	}
})
it('refuses safe navigation when native SDK close fails', async () => {
	const f = fixture()
	f.close.mockRejectedValue(new Error('Unsettled native close'))
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ url: 'https://provider.example.invalid/authorize' }))
	)
	try {
		f.actor.start()
		f.actor.send({
			type: 'ATPROTO',
			scope: f.actor.getSnapshot().context.scope,
			handle: 'derocher.me'
		})
		await waitFor(f.actor, (snapshot) => snapshot.matches('failed'))
		expect(f.close).toHaveBeenCalledOnce()
		expect(f.actor.getSnapshot().status).toBe('active')
	} finally {
		f.actor.stop()
		f.owner.stop()
		vi.unstubAllGlobals()
	}
})

it('waits for the account store and its native transport after SDK close before reporting realm closure', async () => {
	const release = Promise.withResolvers<{ scope: string; requestId: string }>()
	const closeStore = vi.fn(() => release.promise)
	const f = fixture(undefined, closeStore)
	try {
		f.actor.start()
		f.actor.send({ type: 'SHUTDOWN' })
		await waitFor(f.actor, (snapshot) => snapshot.matches('closingAccountStore'), { timeout: 1000 })
		expect(f.close).toHaveBeenCalledOnce()
		expect(closeStore).toHaveBeenCalledOnce()
		expect(f.actor.getSnapshot().status).toBe('active')
		release.resolve({ scope: 'original', requestId: 'actual-close' })
		await waitFor(f.actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
	} finally {
		release.resolve({ scope: 'original', requestId: 'actual-close' })
		f.actor.stop()
		f.owner.stop()
	}
})

it('account-store close failure refuses clean worker closure', async () => {
	const closeStore = vi.fn(async () => {
		throw new Error('unsettled account custody')
	})
	const f = fixture(undefined, closeStore)
	try {
		f.actor.start()
		f.actor.send({ type: 'SHUTDOWN' })
		await waitFor(f.actor, (snapshot) => snapshot.matches('failed'), { timeout: 1000 })
		expect(f.close).toHaveBeenCalledOnce()
		expect(closeStore).toHaveBeenCalledOnce()
		expect(f.actor.getSnapshot().status).toBe('active')
	} finally {
		f.actor.stop()
		f.owner.stop()
	}
})

it('awaits SDK, account-store and exact broker-host closure in order before reporting CLOSED', async () => {
	const storeReceipt = Promise.withResolvers<{ scope: string; requestId: string }>()
	const brokerReceipt = Promise.withResolvers<{ scope: string; requestId: string }>()
	const closeStore = vi.fn(() => storeReceipt.promise),
		closeBroker = vi.fn(() => brokerReceipt.promise)
	const f = fixture(undefined, closeStore, closeBroker)
	try {
		f.actor.start()
		f.actor.send({ type: 'SHUTDOWN' })
		await waitFor(f.actor, (snapshot) => snapshot.matches('closingAccountStore'), { timeout: 1000 })
		expect(f.close).toHaveBeenCalledOnce()
		expect(closeBroker).not.toHaveBeenCalled()
		storeReceipt.resolve({ scope: 'storage', requestId: 'storage-proof' })
		await waitFor(f.actor, (snapshot) => snapshot.matches('closingBroker'), { timeout: 1000 })
		expect(closeBroker).toHaveBeenCalledOnce()
		expect(f.actor.getSnapshot().status).toBe('active')
		brokerReceipt.resolve({ scope: 'broker', requestId: 'broker-proof' })
		await waitFor(f.actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
	} finally {
		storeReceipt.resolve({ scope: 'storage', requestId: 'storage-proof' })
		brokerReceipt.resolve({ scope: 'broker', requestId: 'broker-proof' })
		f.actor.stop()
		f.owner.stop()
	}
})

it('broker close failure refuses clean realm closure after SDK and account custody settle', async () => {
	const closeStore = vi.fn(async () => ({ scope: 'storage', requestId: 'proof' }))
	const closeBroker = vi.fn(async () => {
		throw new Error('broker closure unknown')
	})
	const f = fixture(undefined, closeStore, closeBroker)
	try {
		f.actor.start()
		f.actor.send({ type: 'SHUTDOWN' })
		await waitFor(f.actor, (snapshot) => snapshot.matches('failed'), { timeout: 1000 })
		expect(f.close).toHaveBeenCalledOnce()
		expect(closeStore).toHaveBeenCalledOnce()
		expect(closeBroker).toHaveBeenCalledOnce()
		expect(f.actor.getSnapshot().status).toBe('active')
	} finally {
		f.actor.stop()
		f.owner.stop()
	}
})

it('reports overdue SDK acquisition without losing the late session or acknowledging closure', async () => {
	const acquisition = Promise.withResolvers<void>(),
		clock = new SimulatedClock()
	const f = fixture(acquisition.promise, undefined, undefined, {
		clock,
		closePolicy: { acquisitionMs: 5 }
	})
	try {
		f.actor.start()
		f.actor.send({ type: 'SHUTDOWN' })
		await waitFor(f.actor, (s) => s.matches('settlingAcquisition'), { timeout: 1000 })
		clock.increment(5)
		expect(f.actor.getSnapshot().context.closeIssue).toEqual({
			stage: 'acquisition',
			reason: 'overdue'
		})
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.close).not.toHaveBeenCalled()
		acquisition.resolve()
		await waitFor(f.actor, (s) => s.status === 'done', { timeout: 1000 })
		expect(f.close).toHaveBeenCalledOnce()
	} finally {
		acquisition.resolve()
		f.actor.stop()
		f.owner.stop()
	}
})
it('retains the original SDK close through overdue feedback and consumes its late completion once', async () => {
	const closing = Promise.withResolvers<void>(),
		clock = new SimulatedClock()
	const f = fixture(undefined, undefined, undefined, { clock, closePolicy: { sessionCloseMs: 5 } })
	f.close.mockImplementation(() => closing.promise)
	try {
		f.actor.start()
		f.actor.send({ type: 'SHUTDOWN' })
		await waitFor(f.actor, (s) => s.matches('closingSession'), { timeout: 1000 })
		clock.increment(5)
		expect(f.actor.getSnapshot().context.closeIssue).toEqual({
			stage: 'session',
			reason: 'overdue'
		})
		expect(f.actor.getSnapshot().status).toBe('active')
		f.actor.send({ type: 'SHUTDOWN' })
		clock.increment(100)
		expect(f.close).toHaveBeenCalledOnce()
		closing.resolve()
		await waitFor(f.actor, (s) => s.status === 'done', { timeout: 1000 })
	} finally {
		closing.resolve()
		f.actor.stop()
		f.owner.stop()
	}
})

it('an already queued deadline cannot override actual SDK closure when native timer delivery is delayed', async () => {
	const scheduled = new Map<number, () => void>()
	let sequence = 0
	const clock = {
		setTimeout: (callback: () => void) => {
			scheduled.set(++sequence, callback)
			return sequence
		},
		clearTimeout: (id: number) => {
			scheduled.delete(id)
		}
	}
	const closing = Promise.withResolvers<void>()
	const f = fixture(undefined, undefined, undefined, { clock, closePolicy: { sessionCloseMs: 5 } })
	f.close.mockImplementation(() => closing.promise)
	try {
		f.actor.start()
		f.actor.send({ type: 'SHUTDOWN' })
		await waitFor(f.actor, (s) => s.matches('closingSession'), { timeout: 1000 })
		const delayed = [...scheduled.values()]
		expect(delayed.length).toBeGreaterThan(0)
		closing.resolve()
		await waitFor(f.actor, (s) => s.status === 'done', { timeout: 1000 })
		// Model an already queued native callback delivered after cancellation.
		for (const callback of delayed) callback()
		expect(f.actor.getSnapshot().status).toBe('done')
		expect(f.actor.getSnapshot().context.closeIssue).toBeUndefined()
		expect(f.close).toHaveBeenCalledOnce()
	} finally {
		closing.resolve()
		f.actor.stop()
		f.owner.stop()
	}
})
