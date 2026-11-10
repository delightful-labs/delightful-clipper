import { afterEach, expect, it, vi } from 'vitest'
import { SimulatedClock } from 'xstate'
import type { WorkerRequestIdentity } from 'delightful-local-first/worker/request/contracts'
import { brokerHostClient, serveBrokerHost } from './broker-channel.js'
import { serveHostClose } from './host-close-channel.js'

const cleanup = new Set<() => void>()
afterEach(() => {
	for (const release of cleanup) release()
	cleanup.clear()
	vi.restoreAllMocks()
})
const origin = 'https://clipper.example'
const url = `${origin}/jazz-runtime-worker.js`
const name = 'jazz-runtime:original:generation-0'
const key = 'jazz:shared-worker-generation:jazz-runtime:original'
function wire(identity: WorkerRequestIdentity) {
	return {
		version: 1,
		scope: identity.scope,
		requestId: identity.requestId,
		sequence: identity.sequence
	}
}
function channel() {
	const pair = new MessageChannel()
	const closed = vi.fn()
	pair.port2.addEventListener('close', closed)
	cleanup.add(() => {
		pair.port1.close()
		pair.port2.close()
	})
	return { ...pair, closed }
}
function fixture(manual = false) {
	const data = new MessageChannel(),
		control = new MessageChannel()
	const scope = crypto.randomUUID(),
		clock = new SimulatedClock()
	const native = {
		origin,
		storage: { getItem: vi.fn((): string | null => '2'), setItem: vi.fn() },
		open: vi.fn((_url: string, _name: string) => {
			const pair = channel()
			const worker = Object.assign(new EventTarget(), { port: pair.port1 })
			vi.spyOn(worker, 'removeEventListener')
			return worker
		})
	}
	const onOverdue = vi.fn(),
		onBlocked = vi.fn()
	const release = manual
		? serveHostClose(control.port1, scope, () => {
				data.port1.onmessage = null
				data.port1.close()
			})
		: serveBrokerHost(data.port1, control.port1, scope, native)
	const client = brokerHostClient(data.port2, control.port2, scope, {
		clock,
		requestTimeoutMs: 5,
		closeTimeoutMs: 10,
		onOverdue,
		onBlocked
	})
	cleanup.add(() => {
		client.dispose()
		release()
		data.port1.close()
		control.port1.close()
	})
	return { data, control, scope, clock, native, client, onOverdue, onBlocked }
}

it('preserves exact SDK URL/name and raw generation values, and transfers port ownership to the SDK', async () => {
	const f = fixture()
	f.native.storage.getItem.mockReturnValue('legacy malformed value')
	const reading = f.client.readGeneration(key),
		writing = f.client.writeGeneration(key, '3')
	const opened = await f.client.open(url, name)
	cleanup.add(() => opened.port.close())
	expect(await reading).toBe('legacy malformed value')
	await writing
	expect(f.native.storage.getItem).toHaveBeenCalledExactlyOnceWith(key)
	expect(f.native.storage.setItem).toHaveBeenCalledExactlyOnceWith(key, '3')
	expect(f.native.open).toHaveBeenCalledExactlyOnceWith(url, name)
	const worker = f.native.open.mock.results[0]?.value
	if (!worker) throw new Error('Missing native worker')
	expect(await f.client.close()).toEqual(f.client.host.identity)
	expect(worker.removeEventListener).toHaveBeenCalledWith('error', expect.any(Function))
	expect(f.onBlocked).not.toHaveBeenCalled()
})

it('validates bounds before sequence allocation and never rewrites native generation keys', async () => {
	const f = fixture(),
		posted: number[] = []
	f.data.port1.addEventListener('message', (event) => posted.push(event.data.sequence))
	await expect(f.client.open(url + 'x'.repeat(8192), name)).rejects.toMatchObject({
		workerEffectOutcome: 'not-issued'
	})
	await expect(f.client.writeGeneration(key, '9007199254740992')).rejects.toMatchObject({
		workerEffectOutcome: 'not-issued'
	})
	await expect(f.client.readGeneration('foreign-key')).rejects.toMatchObject({
		workerEffectOutcome: 'not-issued'
	})
	expect(await f.client.readGeneration(key)).toBe('2')
	expect(posted).toEqual([1])
	expect(f.native.open).not.toHaveBeenCalled()
	expect(f.native.storage.setItem).not.toHaveBeenCalled()
})

it('bounds concurrency at eight and correlates out-of-order replies', async () => {
	const f = fixture(true),
		messages: WorkerRequestIdentity[] = []
	f.data.port1.onmessage = (event) => messages.push(event.data)
	const reads = Array.from({ length: 8 }, () => f.client.readGeneration(key))
	await expect(f.client.readGeneration(key)).rejects.toMatchObject({
		workerEffectOutcome: 'not-issued'
	})
	await vi.waitFor(() => expect(messages).toHaveLength(8))
	for (let index = 7; index >= 0; index--)
		f.data.port1.postMessage({ ...wire(messages[index]!), type: 'RESULT', value: String(index) })
	expect(await Promise.all(reads)).toEqual(['0', '1', '2', '3', '4', '5', '6', '7'])
	expect(messages.map((message) => message.sequence)).toEqual([1, 2, 3, 4, 5, 6, 7, 8])
	await f.client.close()
})

it('closes stale-scope, wrong-sequence, unknown and duplicate broker ports without settling a live request', async () => {
	const f = fixture(true),
		messages: WorkerRequestIdentity[] = []
	f.data.port1.onmessage = (event) => messages.push(event.data)
	const opening = f.client.open(url, name)
	await vi.waitFor(() => expect(messages).toHaveLength(1))
	const identity = wire(messages[0]!)
	const orphans = [channel(), channel(), channel(), channel()]
	for (const [index, fields] of [
		{ scope: crypto.randomUUID() },
		{ sequence: 99 },
		{ requestId: crypto.randomUUID() }
	].entries()) {
		const pair = orphans[index]!
		f.data.port1.postMessage({ ...identity, ...fields, type: 'OPENED', port: pair.port1 }, [
			pair.port1
		])
	}
	await vi.waitFor(() => {
		for (const pair of orphans.slice(0, 3)) expect(pair.closed).toHaveBeenCalledOnce()
	})
	const accepted = channel()
	f.data.port1.postMessage({ ...identity, type: 'OPENED', port: accepted.port1 }, [accepted.port1])
	const result = await opening
	cleanup.add(() => result.port.close())
	const duplicate = orphans[3]!
	f.data.port1.postMessage({ ...identity, type: 'OPENED', port: duplicate.port1 }, [
		duplicate.port1
	])
	await vi.waitFor(() => expect(duplicate.closed).toHaveBeenCalledOnce())
	const observed = Promise.withResolvers<string>()
	accepted.port2.onmessage = (event) => observed.resolve(event.data)
	await f.client.close()
	result.port.postMessage('still SDK owned')
	expect(await observed.promise).toBe('still SDK owned')
	expect(accepted.closed).not.toHaveBeenCalled()
})

it('rejects foreign scopes, FIFO gaps and duplicate effects before native operations', async () => {
	const f = fixture(),
		replies: unknown[] = []
	f.data.port2.onmessage = (event) => replies.push(event.data)
	const identity = { version: 1, scope: f.scope, requestId: crypto.randomUUID(), sequence: 1 }
	f.data.port2.postMessage({
		...identity,
		scope: crypto.randomUUID(),
		type: 'WRITE',
		key,
		value: '3'
	})
	f.data.port2.postMessage({ ...identity, sequence: 2, type: 'OPEN', url, name })
	f.data.port2.postMessage({ ...identity, type: 'WRITE', key, value: '3' })
	f.data.port2.postMessage({ ...identity, type: 'WRITE', key, value: '4' })
	await vi.waitFor(() => expect(replies).toHaveLength(3))
	expect(f.native.storage.setItem).toHaveBeenCalledExactlyOnceWith(key, '3')
	expect(f.native.open).not.toHaveBeenCalled()
})

it('rejects foreign-origin and credential-bearing URLs without constructing brokers and keeps healthy FIFO continuity', async () => {
	const f = fixture()
	for (const refused of [
		'https://foreign.example/worker.js',
		'https://secret@clipper.example/worker.js'
	])
		await expect(f.client.open(refused, name)).rejects.toMatchObject({
			workerEffectOutcome: 'not-issued'
		})
	expect(f.native.open).not.toHaveBeenCalled()
	expect(await f.client.readGeneration(key)).toBe('2')
})

it.each(['malformed', 'wrong-kind', 'extra-transfer'])(
	'disposes %s reply ports before failing observers',
	async (kind) => {
		const f = fixture(true),
			messages: WorkerRequestIdentity[] = []
		f.data.port1.onmessage = (event) => messages.push(event.data)
		const reading = expect(f.client.readGeneration(key)).rejects.toMatchObject({
			workerEffectOutcome: 'not-issued'
		})
		await vi.waitFor(() => expect(messages).toHaveLength(1))
		const orphan = channel(),
			extra = channel()
		const reply = {
			...wire(messages[0]!),
			type: kind === 'malformed' ? 'INVALID' : 'OPENED',
			port: orphan.port1
		}
		f.data.port1.postMessage(
			reply,
			kind === 'extra-transfer' ? [orphan.port1, extra.port1] : [orphan.port1]
		)
		await reading
		await vi.waitFor(() => expect(orphan.closed).toHaveBeenCalledOnce())
		if (kind === 'extra-transfer')
			await vi.waitFor(() => expect(extra.closed).toHaveBeenCalledOnce())
		expect(await f.client.host.closed).toEqual(f.client.host.identity)
	}
)

it('closes malformed request transfers without issuing their requested native effect', async () => {
	const f = fixture(),
		orphan = channel()
	f.data.port2.postMessage(
		{
			version: 1,
			scope: f.scope,
			requestId: crypto.randomUUID(),
			sequence: 1,
			type: 'OPEN',
			url,
			name,
			port: orphan.port1
		},
		[orphan.port1]
	)
	await vi.waitFor(() => expect(orphan.closed).toHaveBeenCalledOnce())
	expect(f.native.open).not.toHaveBeenCalled()
	expect(await f.client.readGeneration(key)).toBe('2')
})

it('closes an acquired untransferred port if native reply posting fails', async () => {
	const f = fixture(),
		orphan = channel()
	const worker = Object.assign(new EventTarget(), { port: orphan.port1 })
	f.native.open.mockReturnValue(worker)
	vi.spyOn(f.data.port1, 'postMessage').mockImplementation(() => {
		throw new Error('private post diagnostic')
	})
	const opening = expect(f.client.open(url, name)).rejects.toMatchObject({
		workerEffectOutcome: 'unknown'
	})
	await vi.waitFor(() => expect(orphan.closed).toHaveBeenCalledOnce())
	f.clock.increment(5)
	await opening
	expect(await f.client.host.closed).toEqual(f.client.host.identity)
	expect(f.native.open).toHaveBeenCalledOnce()
})

it('reports native constructor failure without exposing diagnostics or retrying', async () => {
	const f = fixture()
	f.native.open.mockImplementation(() => {
		throw new Error('secret native diagnostic')
	})
	await expect(f.client.open(url, name)).rejects.toMatchObject({
		message: 'Broker host unavailable',
		workerEffectOutcome: 'unknown'
	})
	expect(f.native.open).toHaveBeenCalledOnce()
	expect(await f.client.host.closed).toEqual(f.client.host.identity)
})

it('native client post refusal is not issued and closes the broken FIFO scope', async () => {
	const f = fixture()
	vi.spyOn(f.data.port2, 'postMessage').mockImplementation(() => {
		throw new Error('post refused')
	})
	await expect(f.client.writeGeneration(key, '3')).rejects.toMatchObject({
		workerEffectOutcome: 'not-issued'
	})
	expect(await f.client.host.closed).toEqual(f.client.host.identity)
	expect(f.native.storage.setItem).not.toHaveBeenCalled()
})

it.each(['worker', 'data', 'host'])(
	'%s native transport failure settles once and closes through independent control',
	async (source) => {
		const f = fixture()
		if (source === 'worker') {
			const result = await f.client.open(url, name)
			cleanup.add(() => result.port.close())
			f.native.open.mock.results[0]!.value.dispatchEvent(new Event('error'))
		} else if (source === 'data') f.data.port2.dispatchEvent(new MessageEvent('messageerror'))
		else f.data.port1.dispatchEvent(new MessageEvent('messageerror'))
		expect(await f.client.host.closed).toEqual(f.client.host.identity)
		await expect(f.client.open(url, name)).rejects.toMatchObject({
			workerEffectOutcome: 'not-issued'
		})
		expect(f.onBlocked).not.toHaveBeenCalled()
	}
)

it('lost generation WRITE acknowledgement retains exact identity, waits past close timeout and never replays', async () => {
	const f = fixture()
	let issued: WorkerRequestIdentity | undefined, receipt: unknown
	f.data.port1.addEventListener('message', (event) => {
		issued = event.data
	})
	vi.spyOn(f.data.port1, 'postMessage').mockImplementation(() => {})
	const postClose = f.control.port1.postMessage.bind(f.control.port1)
	vi.spyOn(f.control.port1, 'postMessage').mockImplementation((message: unknown) => {
		receipt = message
	})
	let settled = 0,
		closed = false
	void f.client.host.closed.then(
		() => {
			closed = true
		},
		() => {}
	)
	const writing = f.client.writeGeneration(key, '3').then(
		() => {
			settled++
			return undefined
		},
		(error: unknown) => {
			settled++
			return error
		}
	)
	await vi.waitFor(() => expect(f.native.storage.setItem).toHaveBeenCalledOnce())
	f.clock.increment(5)
	expect(await writing).toMatchObject({
		workerEffectOutcome: 'unknown',
		workerRequest: { scope: f.scope, requestId: issued?.requestId, sequence: 1 }
	})
	await vi.waitFor(() => expect(receipt).toBeDefined())
	f.clock.increment(10)
	expect(f.onOverdue).toHaveBeenCalledOnce()
	expect(closed).toBe(false)
	postClose({ version: 1, type: 'HOST_CLOSED', scope: f.scope, requestId: crypto.randomUUID() })
	f.control.port2.dispatchEvent(new MessageEvent('messageerror'))
	postClose(receipt)
	expect(await f.client.host.closed).toEqual(f.client.host.identity)
	expect(settled).toBe(1)
	expect(f.native.storage.setItem).toHaveBeenCalledExactlyOnceWith(key, '3')
})

it('discards an OPENED transfer arriving after request timeout while retaining the late close listener', async () => {
	const f = fixture(true),
		messages: WorkerRequestIdentity[] = []
	let receipt: unknown
	const postClose = f.control.port1.postMessage.bind(f.control.port1)
	vi.spyOn(f.control.port1, 'postMessage').mockImplementation((message: unknown) => {
		receipt = message
	})
	f.data.port1.onmessage = (event) => messages.push(event.data)
	const opening = expect(f.client.open(url, name)).rejects.toMatchObject({
		workerEffectOutcome: 'unknown'
	})
	await vi.waitFor(() => expect(messages).toHaveLength(1))
	// Post a late reply before processing CLOSE_HOST on the independent port.
	f.clock.increment(5)
	await opening
	const orphan = channel()
	f.data.port1.postMessage({ ...wire(messages[0]!), type: 'OPENED', port: orphan.port1 }, [
		orphan.port1
	])
	await vi.waitFor(() => expect(orphan.closed).toHaveBeenCalledOnce())
	await vi.waitFor(() => expect(receipt).toBeDefined())
	postClose(receipt)
	await f.client.host.closed
})

it('forced disposal fails an issued observer without manufacturing host closure', async () => {
	const f = fixture(true)
	const opening = expect(f.client.open(url, name)).rejects.toMatchObject({
		workerEffectOutcome: 'unknown'
	})
	const closure = expect(f.client.host.closed).rejects.toThrow('Broker host closed')
	f.client.dispose()
	await opening
	await closure
})

it('bounds native broker error-listener resources and removes every listener on closure', async () => {
	const f = fixture()
	for (let index = 0; index < 32; index++) {
		const result = await f.client.open(url, name)
		cleanup.add(() => result.port.close())
	}
	await expect(f.client.open(url, name)).rejects.toMatchObject({
		workerEffectOutcome: 'not-issued'
	})
	await f.client.host.closed
	expect(f.native.open).toHaveBeenCalledTimes(32)
	for (const result of f.native.open.mock.results)
		expect(result.value.removeEventListener).toHaveBeenCalledExactlyOnceWith(
			'error',
			expect.any(Function)
		)
})

it('A → B → A uses fresh scopes and refuses delayed A replies and effects in the replacement adapter', async () => {
	const firstA = fixture(),
		b = fixture()
	expect(await firstA.client.readGeneration(key)).toBe('2')
	await firstA.client.close()
	expect(await b.client.readGeneration(key)).toBe('2')
	await b.client.close()
	const nextA = fixture(),
		posted: WorkerRequestIdentity[] = []
	const post = nextA.data.port1.postMessage.bind(nextA.data.port1)
	vi.spyOn(nextA.data.port1, 'postMessage').mockImplementation(() => {})
	nextA.data.port1.addEventListener('message', (event) => posted.push(event.data))
	let settled = false
	const reading = nextA.client.readGeneration(key).then((value) => {
		settled = true
		return value
	})
	await vi.waitFor(() => expect(posted).toHaveLength(1))
	const orphan = channel()
	post({ ...wire(posted[0]!), scope: firstA.scope, type: 'OPENED', port: orphan.port1 }, [
		orphan.port1
	])
	nextA.data.port2.postMessage({
		...wire(posted[0]!),
		scope: firstA.scope,
		type: 'WRITE',
		key,
		value: '99'
	})
	await vi.waitFor(() => expect(orphan.closed).toHaveBeenCalledOnce())
	expect(settled).toBe(false)
	expect(nextA.native.storage.setItem).not.toHaveBeenCalled()
	post({ ...wire(posted[0]!), type: 'RESULT', value: 'fresh A' })
	expect(await reading).toBe('fresh A')
	await nextA.client.close()
})
