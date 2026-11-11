import { setImmediate } from 'node:timers'
import { afterEach, expect, it, vi } from 'vitest'
import { serveHostClose, workerHostControl, type HostControlReport } from './host-close-channel.js'

const releases = new Set<() => void>()
afterEach(() => {
	for (const release of releases) release()
	releases.clear()
})
function fixture(closeHost: () => void = vi.fn()) {
	const data = new MessageChannel(),
		control = new MessageChannel()
	const scope = crypto.randomUUID(),
		requestId = crypto.randomUUID()
	const reports: HostControlReport[] = []
	const serve = serveHostClose(control.port1, scope, closeHost)
	const client = workerHostControl(control.port2, scope)
	const stop = client.listen((report) => reports.push(report))
	const release = () => {
		serve()
		stop()
		data.port1.close()
		data.port2.close()
	}
	releases.add(release)
	return { data, control, scope, requestId, reports, closeHost, client, stop, serve }
}
function envelope(scope: string, requestId: string) {
	return { scope, requestId, version: 1 }
}

it('acknowledges only after actual data-host disposal and prevents later queued effects', async () => {
	const write = vi.fn()
	const f = fixture(() => {
		f.data.port1.onmessage = null
		f.data.port1.close()
	})
	f.data.port1.onmessage = write
	f.data.port1.start()
	f.client.post({ scope: f.scope, requestId: f.requestId })
	await vi.waitFor(() =>
		expect(f.reports).toEqual([
			{ type: 'HOST_CLOSED', receipt: { scope: f.scope, requestId: f.requestId } }
		])
	)
	f.data.port2.postMessage({ type: 'WRITE', value: 'cannot run after receipt' })
	await new Promise<void>((resolve) => setImmediate(resolve))
	expect(write).not.toHaveBeenCalled()
})

it('rejects foreign scopes, versions, extra fields and transferred resources before native close', async () => {
	const f = fixture(),
		extra = new MessageChannel(),
		closed = vi.fn()
	extra.port2.addEventListener('close', closed)
	f.control.port2.postMessage({ ...envelope(crypto.randomUUID(), f.requestId), type: 'CLOSE_HOST' })
	f.control.port2.postMessage({ ...envelope(f.scope, f.requestId), version: 2, type: 'CLOSE_HOST' })
	f.control.port2.postMessage({
		...envelope(f.scope, f.requestId),
		type: 'CLOSE_HOST',
		extra: true
	})
	f.control.port2.postMessage(
		{ ...envelope(f.scope, f.requestId), type: 'CLOSE_HOST', port: extra.port1 },
		[extra.port1]
	)
	await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
	expect(f.closeHost).not.toHaveBeenCalled()
	expect(f.reports).toEqual([])
	extra.port2.close()
})

it('does not manufacture a receipt when native data-host disposal fails', async () => {
	const closeHost = vi.fn(() => {
		throw new Error('native close failed')
	})
	const f = fixture(closeHost)
	f.client.post({ scope: f.scope, requestId: f.requestId })
	await vi.waitFor(() => expect(closeHost).toHaveBeenCalledOnce())
	expect(f.reports).toEqual([])
})

it('control transport errors retain the listener for a later genuine scoped receipt', async () => {
	const f = fixture()
	f.control.port2.dispatchEvent(new MessageEvent('messageerror'))
	expect(f.reports).toEqual([{ type: 'CLOSE_FAILED', scope: f.scope }])
	f.client.post({ scope: f.scope, requestId: f.requestId })
	await vi.waitFor(() => expect(f.reports).toHaveLength(2))
	expect(f.reports[1]).toEqual({
		type: 'HOST_CLOSED',
		receipt: { scope: f.scope, requestId: f.requestId }
	})
})

it('malformed and resource-bearing receipts close orphan ports without granting closure', async () => {
	const f = fixture(),
		extra = new MessageChannel(),
		closed = vi.fn()
	extra.port2.addEventListener('close', closed)
	f.control.port1.postMessage({
		...envelope(f.scope, f.requestId),
		type: 'HOST_CLOSED',
		extra: true
	})
	f.control.port1.postMessage(
		{ ...envelope(f.scope, f.requestId), type: 'HOST_CLOSED', port: extra.port1 },
		[extra.port1]
	)
	await vi.waitFor(() => expect(closed).toHaveBeenCalledOnce())
	expect(f.reports).toEqual([
		{ type: 'CLOSE_FAILED', scope: f.scope },
		{ type: 'CLOSE_FAILED', scope: f.scope }
	])
	extra.port2.close()
	f.client.post({ scope: f.scope, requestId: f.requestId })
	await vi.waitFor(() => expect(f.reports[2]?.type).toBe('HOST_CLOSED'))
})

it('ignores a valid receipt from another host scope', async () => {
	const f = fixture()
	f.control.port1.postMessage({
		...envelope(crypto.randomUUID(), f.requestId),
		type: 'HOST_CLOSED'
	})
	f.client.post({ scope: f.scope, requestId: f.requestId })
	await vi.waitFor(() => expect(f.reports).toHaveLength(1))
	expect(f.reports[0]).toEqual({
		type: 'HOST_CLOSED',
		receipt: { scope: f.scope, requestId: f.requestId }
	})
})

it('rejects invalid outbound correlation before posting and disposal emits no receipt', async () => {
	const f = fixture()
	expect(() => f.client.post({ scope: crypto.randomUUID(), requestId: f.requestId })).toThrow(
		'Invalid host close identity'
	)
	expect(() => f.client.post({ scope: f.scope, requestId: 'invalid' })).toThrow(
		'Invalid host close identity'
	)
	f.stop()
	f.stop()
	f.serve()
	f.serve()
	f.control.port2.dispatchEvent(new MessageEvent('messageerror'))
	await new Promise<void>((resolve) => setImmediate(resolve))
	expect(f.reports).toEqual([])
	expect(f.closeHost).not.toHaveBeenCalled()
})
