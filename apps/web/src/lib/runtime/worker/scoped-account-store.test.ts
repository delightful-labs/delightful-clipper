import { locks } from 'node:worker_threads'
import { setImmediate } from 'node:timers/promises'
import { createActor, SimulatedClock } from 'xstate'
import { afterEach, expect, it, vi } from 'vitest'
import type { WorkerEffectSettlement } from 'delightful-local-first/worker/effect-drain/contracts'
import {
	createScopedWorkerAccountStore,
	scopedAccountUpdateMachine
} from './scoped-account-store.js'
import {
	accountWriteCustodyMachine,
	createAccountWriteLedger,
	issueAccountWrite
} from './account-write-custody.js'
import { createScopedAccountStorage, serveScopedAccountStorage } from './scoped-storage-channel.js'

const cleanups = new Set<() => void>()
const keys = new Set<string>()
afterEach(async () => {
	for (const cleanup of cleanups) cleanup()
	cleanups.clear()
	await vi.waitFor(async () => {
		const snapshot = await locks.query()
		expect(snapshot.held.filter((lock) => keys.has(lock.name))).toHaveLength(0)
		expect(snapshot.pending.filter((lock) => keys.has(lock.name))).toHaveLength(0)
	})
	keys.clear()
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})
function gate<Value>(value: Value) {
	const result = Promise.withResolvers<Value>()
	cleanups.add(() => result.resolve(value))
	return result
}
function fixture(key = `scoped-account-${crypto.randomUUID()}`) {
	vi.stubGlobal('navigator', { locks })
	keys.add(key)
	const clock = new SimulatedClock(),
		identity = { scope: crypto.randomUUID(), requestId: crypto.randomUUID() }
	const closed = gate(identity),
		onOverdue = vi.fn()
	let value: string | null = null
	const storage = {
		read: vi.fn(async () => value),
		write: vi.fn(async (next: string) => {
			value = next
		}),
		host: { identity, closed: closed.promise, requestClose: vi.fn() },
		close: vi.fn(() => {
			storage.host.requestClose()
			return closed.promise
		})
	}
	const store = createScopedWorkerAccountStore(key, storage, { clock, deadlineMs: 10, onOverdue })
	cleanups.add(store.dispose)
	return { key, storage, store, clock, closed, identity, onOverdue, value: () => value }
}
async function busy(key: string) {
	const snapshot = await locks.query()
	return snapshot.held.some((lock) => lock.name === key)
}

it('serializes real SDK transforms under the original native lock and reports success after release', async () => {
	const f = fixture(),
		delayed = gate<void>(undefined)
	f.storage.write.mockImplementationOnce(async () => {
		await delayed.promise
	})
	const firstTransform = vi.fn(() => 'first'),
		secondTransform = vi.fn(() => 'second')
	const first = f.store.update(firstTransform),
		second = f.store.update(secondTransform)
	await vi.waitFor(() => expect(f.storage.write).toHaveBeenCalledOnce())
	expect(await busy(f.key)).toBe(true)
	expect(secondTransform).not.toHaveBeenCalled()
	delayed.resolve()
	await Promise.all([first, second])
	expect(firstTransform).toHaveBeenCalledOnce()
	expect(secondTransform).toHaveBeenCalledOnce()
	expect(await busy(f.key)).toBe(false)
	const closing = f.store.close()
	f.closed.resolve(f.identity)
	expect(await closing).toEqual(f.identity)
})

it.each(['read', 'transform', 'not-issued-write'] as const)(
	'fails %s without replay and releases the original lease',
	async (phase) => {
		const f = fixture(),
			transform = vi.fn(() => 'replacement')
		if (phase === 'read') f.storage.read.mockRejectedValueOnce(new Error('private read failure'))
		if (phase === 'transform')
			transform.mockImplementationOnce(() => {
				throw new Error('private transform failure')
			})
		if (phase === 'not-issued-write')
			f.storage.write.mockRejectedValueOnce(
				Object.assign(new Error('not posted'), { workerEffectOutcome: 'not-issued' })
			)
		await expect(f.store.update(transform)).rejects.toMatchObject({
			writeOutcome: 'not-issued',
			scope: f.identity.scope
		})
		await vi.waitFor(async () => expect(await busy(f.key)).toBe(false))
		const count = transform.mock.calls.length
		await f.store.update(() => 'following')
		expect(transform).toHaveBeenCalledTimes(count)
		expect(f.value()).toBe('following')
		expect(f.storage.host.requestClose).not.toHaveBeenCalled()
	}
)

it('write expiry rejects the observer once while retaining the lock and original transform until real host closure', async () => {
	const f = fixture(),
		delayed = gate<void>(undefined),
		firstTransform = vi.fn(() => 'first')
	f.storage.write.mockImplementationOnce(() => delayed.promise)
	const failed = f.store.update(firstTransform).catch((error: unknown) => error)
	await vi.waitFor(() => expect(f.storage.write).toHaveBeenCalledOnce())
	f.clock.increment(10)
	const failure = await failed
	expect(failure).toMatchObject({ ok: false, scope: f.identity.scope, writeOutcome: 'unknown' })
	const nextTransform = vi.fn(() => 'next'),
		following = f.store.update(nextTransform)
	await setImmediate()
	expect(nextTransform).not.toHaveBeenCalled()
	expect(await busy(f.key)).toBe(true)
	f.clock.increment(9)
	expect(f.storage.host.requestClose).toHaveBeenCalledOnce()
	expect(firstTransform).toHaveBeenCalledOnce()
	expect(f.storage.write).toHaveBeenCalledOnce()
	f.closed.resolve(f.identity)
	await following
	expect(nextTransform).toHaveBeenCalledOnce()
	expect(await failed).toBe(failure)
	expect(firstTransform).toHaveBeenCalledOnce()
})

it('a late native write acknowledgement drains the original call without changing its failed observer result', async () => {
	const f = fixture(),
		delayed = gate<void>(undefined)
	f.storage.write.mockImplementationOnce(() => delayed.promise)
	const failed = f.store.update(() => 'once').catch((error: unknown) => error)
	await vi.waitFor(() => expect(f.storage.write).toHaveBeenCalledOnce())
	f.clock.increment(10)
	const result = await failed
	expect(await busy(f.key)).toBe(true)
	delayed.resolve()
	await vi.waitFor(async () => expect(await busy(f.key)).toBe(false))
	expect(await failed).toBe(result)
	expect(f.storage.write).toHaveBeenCalledOnce()
})

it('close waits for uncertain writes and native lease release before acknowledging the scoped transport', async () => {
	const f = fixture(),
		delayed = gate<void>(undefined)
	f.storage.write.mockImplementationOnce(() => delayed.promise)
	const failed = f.store.update(() => 'once').catch((error: unknown) => error)
	await vi.waitFor(() => expect(f.storage.write).toHaveBeenCalledOnce())
	let complete = false
	const closing = f.store.close().then((receipt) => {
		complete = true
		return receipt
	})
	expect(await failed).toMatchObject({ writeOutcome: 'unknown' })
	f.clock.increment(20)
	await setImmediate()
	expect(complete).toBe(false)
	expect(f.storage.close).not.toHaveBeenCalled()
	expect(await busy(f.key)).toBe(true)
	f.closed.resolve(f.identity)
	expect(await closing).toEqual(f.identity)
	expect(await busy(f.key)).toBe(false)
})

it('aborts a queued native lock before it can run a late SDK transform', async () => {
	const f = fixture(),
		blocker = gate<void>(undefined),
		acquired = gate<void>(undefined)
	const holding = locks.request(f.key, async () => {
		acquired.resolve()
		await blocker.promise
	})
	await acquired.promise
	const transform = vi.fn(() => 'must not issue')
	const failed = f.store.update(transform).catch((error: unknown) => error)
	await setImmediate()
	f.clock.increment(10)
	expect(await failed).toMatchObject({ writeOutcome: 'not-issued' })
	blocker.resolve()
	await holding
	await setImmediate()
	expect(transform).not.toHaveBeenCalled()
	expect(f.storage.write).not.toHaveBeenCalled()
})

it('bounds admission at eight updates without starting an excess transform', async () => {
	const f = fixture(),
		delayed = gate<void>(undefined)
	f.storage.write.mockImplementationOnce(() => delayed.promise)
	const calls = Array.from({ length: 8 }, (_, index) => f.store.update(() => String(index)))
	const excess = vi.fn(() => 'excess')
	await expect(f.store.update(excess)).rejects.toMatchObject({ writeOutcome: 'not-issued' })
	expect(excess).not.toHaveBeenCalled()
	delayed.resolve()
	await Promise.all(calls)
	expect(f.storage.write).toHaveBeenCalledTimes(8)
})

it('a forced parent stop transfers issued-write custody without releasing the actual lock', async () => {
	const f = fixture(),
		delayed = gate<void>(undefined)
	f.storage.write.mockImplementationOnce(() => delayed.promise)
	const failed = f.store.update(() => 'once').catch((error: unknown) => error)
	await vi.waitFor(() => expect(f.storage.write).toHaveBeenCalledOnce())
	f.store.dispose()
	expect(await failed).toMatchObject({ writeOutcome: 'unknown' })
	await vi.waitFor(() => expect(f.storage.host.requestClose).toHaveBeenCalledOnce())
	expect(await busy(f.key)).toBe(true)
	f.clock.increment(20)
	expect(await busy(f.key)).toBe(true)
	f.closed.resolve(f.identity)
	await vi.waitFor(async () => expect(await busy(f.key)).toBe(false))
	expect(f.storage.write).toHaveBeenCalledOnce()
})

it('unexpected child transition failure transfers custody before shutdown can observe an empty population', async () => {
	vi.stubGlobal('navigator', { locks })
	const key = `scoped-account-${crypto.randomUUID()}`
	keys.add(key)
	const identity = { scope: crypto.randomUUID(), requestId: crypto.randomUUID() },
		closed = gate(identity)
	const overdue = vi.fn(),
		clock = new SimulatedClock()
	const storage = {
		read: async () => null,
		write: vi.fn(async () => {
			throw new Error('lost reply')
		}),
		host: { identity, closed: closed.promise, requestClose: vi.fn() },
		close: vi.fn(() => closed.promise)
	}
	const operation = scopedAccountUpdateMachine.provide({
		guards: {
			writeNotIssued: () => {
				throw new Error('unexpected chart failure')
			}
		}
	})
	const store = createScopedWorkerAccountStore(key, storage, {
		clock,
		deadlineMs: 10,
		onOverdue: overdue,
		operation
	})
	cleanups.add(store.dispose)
	await expect(store.update(() => 'once')).rejects.toMatchObject({ writeOutcome: 'unknown' })
	let complete = false
	const closing = store.close().then((receipt) => {
		complete = true
		return receipt
	})
	await setImmediate()
	expect(await busy(key)).toBe(true)
	expect(complete).toBe(false)
	expect(storage.close).not.toHaveBeenCalled()
	closed.resolve(identity)
	expect(await closing).toEqual(identity)
	expect(await busy(key)).toBe(false)
})

it('missing native release acknowledgement keeps completion pending even after a successful write', async () => {
	const releaseAck = gate<void>(undefined)
	const delayedLocks = {
		request: (name: string, options: { signal: AbortSignal }, callback: () => Promise<void>) =>
			locks.request(name, options, callback).then(async (result) => {
				await releaseAck.promise
				return result
			})
	}
	const f = fixture()
	vi.stubGlobal('navigator', { locks: delayedLocks })
	const result = f.store.update(() => 'acknowledged').catch((error: unknown) => error)
	await vi.waitFor(() => expect(f.storage.write).toHaveBeenCalledOnce())
	await vi.waitFor(async () => expect(await busy(f.key)).toBe(false))
	f.clock.increment(10)
	expect(await result).toMatchObject({ ok: false, writeOutcome: 'acknowledged' })
	let complete = false
	const closing = f.store.close().then((receipt) => {
		complete = true
		return receipt
	})
	f.closed.resolve(f.identity)
	await setImmediate()
	expect(complete).toBe(false)
	releaseAck.resolve()
	expect(await closing).toEqual(f.identity)
})

it('the custody keeper refuses a replacement scope even when that replacement supplies a valid receipt', async () => {
	const key = `scoped-account-${crypto.randomUUID()}`
	keys.add(key)
	const release = gate<void>(undefined),
		acquired = gate<void>(undefined),
		native = gate<WorkerEffectSettlement>({ kind: 'settled' })
	const holding = locks.request(key, async () => {
		acquired.resolve()
		await release.promise
	})
	await acquired.promise
	const scope = crypto.randomUUID(),
		identity = { scope: crypto.randomUUID(), requestId: crypto.randomUUID() }
	const releaseLease = vi.fn(async () => {
		release.resolve()
		await holding
	})
	const actor = createActor(accountWriteCustodyMachine, {
		input: {
			operationId: 'original-operation',
			scope,
			host: { identity, closed: Promise.resolve(identity), requestClose: vi.fn() },
			settlement: native.promise,
			release: releaseLease,
			deadlineMs: 10,
			onOverdue: vi.fn()
		}
	}).start()
	cleanups.add(() => actor.stop())
	await setImmediate()
	expect(releaseLease).not.toHaveBeenCalled()
	expect(await busy(key)).toBe(true)
	expect(actor.getSnapshot().output).toBeUndefined()
	release.resolve()
	await holding
})

it('revoked native write admission refuses a late orphaned call before any storage effect', () => {
	const ledger = createAccountWriteLedger(),
		write = vi.fn(async () => {})
	ledger.handoff()
	expect(() => issueAccountWrite(ledger, write)).toThrow('Account storage update failed')
	expect(write).not.toHaveBeenCalled()
})

it('records the native receipt before a write can reenter forced parent disposal', async () => {
	const f = fixture(),
		delayed = gate<void>(undefined)
	f.storage.write.mockImplementationOnce(() => {
		f.store.dispose()
		return delayed.promise
	})
	const failed = f.store.update(() => 'original').catch((error: unknown) => error)
	expect(await failed).toMatchObject({ writeOutcome: 'unknown' })
	expect(await busy(f.key)).toBe(true)
	const second = fixture(f.key),
		nextTransform = vi.fn(() => 'following')
	const following = second.store.update(nextTransform)
	await setImmediate()
	expect(nextTransform).not.toHaveBeenCalled()
	delayed.resolve()
	await following
	expect(nextTransform).toHaveBeenCalledOnce()
	expect(f.storage.write).toHaveBeenCalledOnce()
})

it('forced disposal while native release is overdue transfers the release receipt and preserves known write acknowledgement', async () => {
	const releaseAck = gate<void>(undefined)
	const delayedLocks = {
		request: (name: string, options: { signal: AbortSignal }, callback: () => Promise<void>) =>
			locks.request(name, options, callback).then(async () => {
				await releaseAck.promise
			})
	}
	const f = fixture()
	vi.stubGlobal('navigator', { locks: delayedLocks })
	const result = f.store.update(() => 'acknowledged').catch((error: unknown) => error)
	await vi.waitFor(() => expect(f.storage.write).toHaveBeenCalledOnce())
	await vi.waitFor(async () => expect(await busy(f.key)).toBe(false))
	f.store.dispose()
	const error = await result
	expect(error).toMatchObject({ ok: false, writeOutcome: 'acknowledged' })
	await setImmediate()
	f.clock.increment(10)
	expect(f.onOverdue).toHaveBeenCalledOnce()
	releaseAck.resolve()
	expect(await result).toBe(error)
	expect(f.storage.write).toHaveBeenCalledOnce()
})

it('real scoped RPC with a dropped write reply blocks a competing account transform until the late host-close receipt', async () => {
	vi.stubGlobal('navigator', { locks })
	const key = `scoped-account-${crypto.randomUUID()}`
	keys.add(key)
	const data = new MessageChannel(),
		control = new MessageChannel(),
		scope = crypto.randomUUID(),
		clock = new SimulatedClock()
	let value: string | null = null,
		receipt: unknown
	const native = {
		getItem: () => value,
		setItem: vi.fn((_key: string, next: string) => {
			value = next
		})
	}
	const releaseHost = serveScopedAccountStorage(data.port1, control.port1, scope, native, key)
	const postData = data.port1.postMessage.bind(data.port1)
	vi.spyOn(data.port1, 'postMessage').mockImplementation((message: unknown) => {
		if (
			typeof message === 'object' &&
			message !== null &&
			'sequence' in message &&
			message.sequence === 2
		)
			return
		postData(message)
	})
	const postReceipt = control.port1.postMessage.bind(control.port1)
	vi.spyOn(control.port1, 'postMessage').mockImplementation((message: unknown) => {
		receipt = message
	})
	const storage = createScopedAccountStorage(data.port2, control.port2, scope, {
		clock,
		requestTimeoutMs: 5,
		closeTimeoutMs: 10,
		onOverdue: vi.fn(),
		onBlocked: vi.fn()
	})
	const store = createScopedWorkerAccountStore(key, storage, {
		clock,
		deadlineMs: 20,
		onOverdue: vi.fn()
	})
	cleanups.add(() => {
		postReceipt(receipt)
		store.dispose()
		storage.dispose()
		releaseHost()
		data.port1.close()
		control.port1.close()
	})
	const transform = vi.fn(() => 'persisted')
	const failed = store.update(transform).catch((error: unknown) => error)
	await vi.waitFor(() => expect(native.setItem).toHaveBeenCalledOnce())
	clock.increment(5)
	expect(await failed).toMatchObject({ writeOutcome: 'unknown', scope })
	await vi.waitFor(() => expect(receipt).toBeDefined())
	const second = fixture(key),
		followingTransform = vi.fn(() => 'following')
	second.storage.read.mockImplementation(async () => value)
	const following = second.store.update(followingTransform)
	await setImmediate()
	clock.increment(10)
	expect(followingTransform).not.toHaveBeenCalled()
	expect(await busy(key)).toBe(true)
	postReceipt(receipt)
	await following
	expect(transform).toHaveBeenCalledOnce()
	expect(native.setItem).toHaveBeenCalledOnce()
	expect(followingTransform).toHaveBeenCalledExactlyOnceWith('persisted')
	expect(value).toBe('persisted')
})
