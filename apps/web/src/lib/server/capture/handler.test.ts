import { expect, it } from 'vitest'
import { capture } from './handler.js'
const request = (body: unknown) =>
	new Request('https://clipper.example/api/capture/extract', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify(body)
	})
const input = () => ({
	protocolVersion: 1,
	operationId: crypto.randomUUID(),
	url: 'http://127.0.0.1/'
})
it('requires verified identity and explicit deployment qualification', async () => {
	expect((await capture(request(input()), undefined, 'extract', true)).status).toBe(401)
	expect((await capture(request(input()), 'owner', 'extract')).status).toBe(503)
})
it('rejects malformed and over-limit requests with private stable error responses', async () => {
	for (const body of [
		{},
		{ ...input(), headers: { Cookie: 'secret' } },
		{ ...input(), operationId: 'bad' },
		'a'.repeat(17000)
	]) {
		const response = await capture(request(body), crypto.randomUUID(), 'extract', true)
		expect([400, 413]).toContain(response.status)
		expect(response.headers.get('Cache-Control')).toBe('private, no-store')
		expect(await response.text()).not.toContain('secret')
	}
})
it('blocks a private destination before connecting upstream', async () => {
	const response = await capture(request(input()), crypto.randomUUID(), 'extract', true)
	expect(response.status).toBe(400)
	expect(await response.json()).toEqual({ code: 'redirectBlocked', retryable: false })
})
it('bounds per-owner attempts and supplies Retry-After', async () => {
	const owner = crypto.randomUUID()
	for (let i = 0; i < 20; i++)
		expect((await capture(request(input()), owner, 'extract', true)).status).toBe(400)
	const response = await capture(request(input()), owner, 'extract', true)
	expect(response.status).toBe(429)
	expect(response.headers.get('Retry-After')).toBe('60')
})
it('refuses foreign browser origins even with an admitted identity', async () => {
	const req = request(input())
	req.headers.set('Origin', 'https://foreign.example')
	expect((await capture(req, crypto.randomUUID(), 'extract', true)).status).toBe(403)
})

it('bounds total instance admission and releases slots after body cancellation', async () => {
	const controllers = Array.from({ length: 4 }, () => new AbortController())
	const pending = controllers.map((controller) => {
		const init = {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: new ReadableStream<Uint8Array>(),
			duplex: 'half',
			signal: controller.signal
		}
		return capture(
			new Request('https://clipper.example/api/capture/extract', init),
			crypto.randomUUID(),
			'extract',
			true
		)
	})
	try {
		expect((await capture(request(input()), crypto.randomUUID(), 'extract', true)).status).toBe(429)
	} finally {
		for (const controller of controllers) controller.abort()
	}
	const results = await Promise.all(pending)
	expect(results.every((response) => response.status === 408)).toBe(true)
	expect((await capture(request(input()), crypto.randomUUID(), 'extract', true)).status).toBe(400)
})

it('requires verified identity and blocks private image destinations on the asset endpoint', async () => {
	expect((await capture(request(input()), undefined, 'asset', true)).status).toBe(401)
	const response = await capture(request(input()), crypto.randomUUID(), 'asset', true)
	expect(response.status).toBe(400)
	expect(await response.json()).toEqual({ code: 'redirectBlocked', retryable: false })
	expect(response.headers.get('Cache-Control')).toBe('private, no-store')
})
