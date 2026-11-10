import { setImmediate } from 'node:timers'
import { afterEach, expect, it, vi } from 'vitest'
import { SimulatedClock } from 'xstate'
import type { WorkerRequestIdentity } from 'delightful-local-first/worker/request/contracts'
import { serveHostClose } from './host-close-channel.js'
import {
	createScopedAccountStorage,
	createScopedStorageHost,
	serveScopedAccountStorage
} from './scoped-storage-channel.js'

const releases = new Set<() => void>()
afterEach(() => {
	for (const release of releases) release()
	releases.clear()
	vi.restoreAllMocks()
})
function fixture(manualHost = false) {
	const data = new MessageChannel(),
		control = new MessageChannel(),
		scope = crypto.randomUUID()
	const clock = new SimulatedClock(),
		onOverdue = vi.fn(),
		onBlocked = vi.fn()
	let value: string | null = 'saved identity'
	const native = {
		getItem: vi.fn(() => value),
		setItem: vi.fn((_key: string, next: string) => {
			value = next
		})
	}
	const releaseHost = manualHost
		? serveHostClose(control.port1, scope, () => {
				data.port1.onmessage = null
				data.port1.close()
			})
		: serveScopedAccountStorage(data.port1, control.port1, scope, native, 'original-key')
	const storage = createScopedAccountStorage(data.port2, control.port2, scope, {
		clock,
		onOverdue,
		onBlocked,
		requestTimeoutMs: 5,
		closeTimeoutMs: 10
	})
	releases.add(() => {
		storage.dispose()
		releaseHost()
		data.port1.close()
		control.port1.close()
	})
	return { data, control, scope, storage, native, clock, onOverdue, onBlocked, value: () => value }
}

it('correlates concurrent requests, preserves the bound key and gracefully closes', async () => {
	const f = fixture()
	const before = f.storage.read(),
		write = f.storage.write('updated identity'),
		after = f.storage.read()
	expect(await before).toBe('saved identity')
	await write
	expect(await after).toBe('updated identity')
	expect(f.native.getItem).toHaveBeenNthCalledWith(1, 'original-key')
	expect(f.native.getItem).toHaveBeenNthCalledWith(2, 'original-key')
	expect(f.native.setItem).toHaveBeenCalledExactlyOnceWith('original-key', 'updated identity')
	expect(await f.storage.close()).toEqual(f.storage.host.identity)
	await expect(f.storage.read()).rejects.toMatchObject({
		message: 'Account storage closed',
		workerEffectOutcome: 'not-issued'
	})
	expect(f.onBlocked).not.toHaveBeenCalled()
})

it('rejects an oversized write before allocating a wire sequence', async () => {
	const f = fixture(),
		posted: number[] = []
	f.data.port1.addEventListener('message', (event) => {
		if (typeof event.data.sequence === 'number') posted.push(event.data.sequence)
	})
	await expect(f.storage.write('x'.repeat(1024 * 1024 + 1))).rejects.toMatchObject({
		workerEffectOutcome: 'not-issued'
	})
	expect(await f.storage.read()).toBe('saved identity')
	expect(posted).toEqual([1])
	expect(f.native.setItem).not.toHaveBeenCalled()
	await f.storage.close()
})

it('routes out-of-order replies and ignores stale sequence/scope without replay', async () => {
	const f = fixture(true)
	const messages: { scope: string; requestId: string; sequence: number }[] = []
	f.data.port1.onmessage = ({ data }) => messages.push(data)
	const first = f.storage.read(),
		second = f.storage.read()
	await vi.waitFor(() => expect(messages).toHaveLength(2))
	f.data.port1.postMessage({
		...messages[0],
		version: 1,
		type: 'RESULT',
		scope: crypto.randomUUID(),
		value: 'old scope'
	})
	f.data.port1.postMessage({
		...messages[0],
		version: 1,
		type: 'RESULT',
		sequence: 99,
		value: 'old sequence'
	})
	f.data.port1.postMessage({ ...messages[1], version: 1, type: 'RESULT', value: 'second' })
	f.data.port1.postMessage({ ...messages[0], version: 1, type: 'RESULT', value: 'first' })
	expect(await second).toBe('second')
	expect(await first).toBe('first')
	expect(messages).toHaveLength(2)
	await f.storage.close()
})

it('rejects foreign scope and FIFO gaps before touching the native store', async () => {
	const data = new MessageChannel(),
		control = new MessageChannel(),
		scope = crypto.randomUUID()
	const native = { getItem: vi.fn(() => 'value'), setItem: vi.fn() },
		replies: unknown[] = []
	const release = serveScopedAccountStorage(data.port1, control.port1, scope, native, 'same-key')
	releases.add(() => {
		release()
		data.port2.close()
		control.port2.close()
	})
	data.port2.onmessage = (event) => replies.push(event.data)
	data.port2.postMessage({
		version: 1,
		scope: crypto.randomUUID(),
		requestId: crypto.randomUUID(),
		sequence: 1,
		type: 'READ'
	})
	data.port2.postMessage({
		version: 1,
		scope,
		requestId: crypto.randomUUID(),
		sequence: 2,
		type: 'READ'
	})
	await vi.waitFor(() => expect(replies).toHaveLength(1))
	expect(replies[0]).toMatchObject({
		type: 'FAILED',
		reason: 'invalid-reply',
		effectOutcome: 'not-issued'
	})
	expect(native.getItem).not.toHaveBeenCalled()
	data.port2.postMessage({
		version: 1,
		scope,
		requestId: crypto.randomUUID(),
		sequence: 1,
		type: 'READ'
	})
	await vi.waitFor(() => expect(native.getItem).toHaveBeenCalledExactlyOnceWith('same-key'))
})

it('native write failure reports unknown execution and closes the original host', async () => {
	const f = fixture()
	f.native.setItem.mockImplementationOnce(() => {
		throw new Error('private native storage failure')
	})
	await expect(f.storage.write('attempt')).rejects.toMatchObject({
		message: 'Account storage unavailable',
		workerEffectOutcome: 'unknown',
		workerRequest: { scope: f.scope, sequence: 1 }
	})
	expect(await f.storage.host.closed).toEqual(f.storage.host.identity)
	expect(f.native.setItem).toHaveBeenCalledOnce()
})

it('lost WRITE acknowledgement retains identity and late close proof without replaying the effect', async () => {
	const f = fixture()
	let issuedIdentity: WorkerRequestIdentity | undefined
	f.data.port1.addEventListener('message', ({ data }: MessageEvent<WorkerRequestIdentity>) => {
		issuedIdentity = { scope: data.scope, requestId: data.requestId, sequence: data.sequence }
	})
	const postData = f.data.port1.postMessage.bind(f.data.port1)
	vi.spyOn(f.data.port1, 'postMessage').mockImplementation((message: unknown) => {
		if (
			typeof message === 'object' &&
			message !== null &&
			'type' in message &&
			message.type === 'RESULT'
		)
			return
		postData(message)
	})
	let lateReceipt: unknown
	const postControl = f.control.port1.postMessage.bind(f.control.port1)
	vi.spyOn(f.control.port1, 'postMessage').mockImplementation((message: unknown) => {
		lateReceipt = message
	})
	let provedClosed = false
	void f.storage.host.closed.then(
		() => {
			provedClosed = true
		},
		() => {}
	)
	const writing = f.storage.write('persisted but unacknowledged').then(
		() => undefined,
		(error: unknown) => error
	)
	await vi.waitFor(() => expect(f.native.setItem).toHaveBeenCalledOnce())
	f.clock.increment(5)
	expect(issuedIdentity).toBeDefined()
	expect(await writing).toMatchObject({
		workerEffectOutcome: 'unknown',
		workerRequest: issuedIdentity
	})
	await vi.waitFor(() => expect(lateReceipt).toBeDefined())
	f.clock.increment(10)
	expect(f.onOverdue).toHaveBeenCalledOnce()
	expect(provedClosed).toBe(false)
	expect(f.value()).toBe('persisted but unacknowledged')
	postControl({
		version: 1,
		type: 'HOST_CLOSED',
		scope: crypto.randomUUID(),
		requestId: f.storage.host.identity.requestId
	})
	postControl({ version: 1, type: 'HOST_CLOSED', scope: f.scope, requestId: crypto.randomUUID() })
	await new Promise<void>((resolve) => setImmediate(resolve))
	expect(provedClosed).toBe(false)
	postControl(lateReceipt)
	expect(await f.storage.host.closed).toEqual(f.storage.host.identity)
	await expect(f.storage.write('must not replay')).rejects.toMatchObject({
		workerEffectOutcome: 'not-issued'
	})
	expect(f.native.setItem).toHaveBeenCalledOnce()
})

it('malformed reply transfers are closed before a pending read fails', async () => {
	const f = fixture(true),
		orphan = new MessageChannel(),
		closed = vi.fn()
	orphan.port2.addEventListener('close', closed)
	releases.add(() => orphan.port2.close())
	const reading = expect(f.storage.read()).rejects.toMatchObject({
		workerEffectOutcome: 'not-issued'
	})
	f.data.port1.postMessage({ type: 'INVALID', port: orphan.port1 }, [orphan.port1])
	await reading
	await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
	expect(await f.storage.host.closed).toEqual(f.storage.host.identity)
})

it('a native post failure is definitely not issued and invalidates its FIFO scope', async () => {
	const f = fixture()
	vi.spyOn(f.data.port2, 'postMessage').mockImplementation(() => {
		throw new Error('native post refused')
	})
	await expect(f.storage.write('not posted')).rejects.toMatchObject({
		workerEffectOutcome: 'not-issued'
	})
	expect(await f.storage.host.closed).toEqual(f.storage.host.identity)
	expect(f.native.setItem).not.toHaveBeenCalled()
})

it('failed Window reply posting closes its data host without throwing or replaying a completed primitive', async () => {
	const f = fixture()
	vi.spyOn(f.data.port1, 'postMessage').mockImplementation(() => {
		throw new Error('native reply post failed')
	})
	const writing = expect(f.storage.write('completed native primitive')).rejects.toMatchObject({
		workerEffectOutcome: 'unknown'
	})
	await vi.waitFor(() => expect(f.native.setItem).toHaveBeenCalledOnce())
	f.clock.increment(5)
	await writing
	expect(await f.storage.host.closed).toEqual(f.storage.host.identity)
	expect(f.value()).toBe('completed native primitive')
	expect(f.native.setItem).toHaveBeenCalledOnce()
})

it('data-port failure reports an unknown issued write and uses the independent close port', async () => {
	const f = fixture(true)
	const writing = expect(f.storage.write('unacknowledged')).rejects.toMatchObject({
		workerEffectOutcome: 'unknown'
	})
	f.data.port2.dispatchEvent(new MessageEvent('messageerror'))
	await writing
	expect(await f.storage.host.closed).toEqual(f.storage.host.identity)
})

it('forced disposal fails observers and rejects closure observation without manufacturing a receipt', async () => {
	const f = fixture(true)
	const writing = expect(f.storage.write('unacknowledged')).rejects.toMatchObject({
		workerEffectOutcome: 'unknown'
	})
	const closure = expect(f.storage.host.closed).rejects.toThrow('Account storage closed')
	f.storage.dispose()
	await writing
	await closure
	expect(f.onBlocked).not.toHaveBeenCalled()
})

it('closes before namespace binding and never recreates a data host for a late namespace', async () => {
	const data = new MessageChannel(),
		control = new MessageChannel(),
		scope = crypto.randomUUID()
	const native = { getItem: vi.fn(() => 'late value'), setItem: vi.fn() }
	const host = createScopedStorageHost(data.port1, control.port1, scope, native)
	const storage = createScopedAccountStorage(data.port2, control.port2, scope, {
		onOverdue: vi.fn(),
		onBlocked: vi.fn()
	})
	releases.add(() => {
		storage.dispose()
		host.dispose()
	})
	expect(await storage.close()).toEqual(storage.host.identity)
	expect(host.bind('must-not-open')).toBe(false)
	expect(native.getItem).not.toHaveBeenCalled()
	expect(native.setItem).not.toHaveBeenCalled()
})
