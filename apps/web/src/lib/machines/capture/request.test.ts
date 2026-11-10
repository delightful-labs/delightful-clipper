import { it, expect, vi } from 'vitest'
import { createActor, SimulatedClock, toPromise } from 'xstate'
import { createCaptureRequestMachine } from './request.js'
import { createGatewayMachine } from './gateway.js'
import { CaptureError } from '../../server/capture/errors.js'
import type { CaptureInput } from './request.js'
import type { ExtractedContent } from '../../server/capture/parser-protocol.js'
const parsed = { operationId: 'operation', url: 'https://example.com/' }
function fixture(
	options: {
		read?: (signal: AbortSignal) => Promise<CaptureInput>
		extract?: (signal: AbortSignal) => Promise<ExtractedContent>
		now?: () => number
		mode?: 'resolve' | 'extract'
	} = {}
) {
	const clock = new SimulatedClock(),
		controller = new AbortController(),
		release = vi.fn()
	const acquire = vi.fn(() => release)
	const read = vi.fn(async (_request: Request, signal: AbortSignal) =>
		options.read ? options.read(signal) : parsed
	)
	const extract = vi.fn(
		async (_body: Uint8Array, _type: string, _url: string, signal: AbortSignal) => {
			if (options.extract) return options.extract(signal)
			throw new CaptureError('parseFailed', 422)
		}
	)
	const gateway = createGatewayMachine({
		resolve: async () => ({ address: '1.1.1.1', family: 4 }),
		fetch: async () => ({
			status: 200,
			mediaType: 'text/html',
			location: undefined,
			body: new Uint8Array([1])
		}),
		extract
	})
	const actor = createActor(
		createCaptureRequestMachine({
			acquire,
			read,
			gateway,
			now: options.now ?? (() => clock.now()),
			deadlineMs: 20
		}),
		{
			clock,
			input: {
				request: new Request('https://clipper.example/api/capture/resolve', {
					signal: controller.signal
				}),
				accountId: 'owner',
				enabled: true,
				mode: options.mode ?? 'resolve'
			}
		}
	).start()
	return { actor, clock, controller, acquire, release, read, extract }
}
it('deadline aborts input but retains its admission lease until body cleanup settles', async () => {
	const gate = Promise.withResolvers<CaptureInput>()
	let signal: AbortSignal | undefined
	const f = fixture({
		read: (s) => {
			signal = s
			return gate.promise
		}
	})
	await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce())
	f.clock.increment(20)
	expect(signal?.aborted).toBe(true)
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.release).not.toHaveBeenCalled()
	gate.reject(new Error('body aborted'))
	const response = await toPromise(f.actor)
	expect(response.status).toBe(504)
	expect(await response.json()).toEqual({ code: 'fetchTimeout', retryable: true })
	expect(f.release).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().context.input).toBeUndefined()
})
it('client cancellation drains the invoked parser/gateway before releasing the lease', async () => {
	const gate = Promise.withResolvers<ExtractedContent>()
	let signal: AbortSignal | undefined
	const f = fixture({
		mode: 'extract',
		extract: (s) => {
			signal = s
			return gate.promise
		}
	})
	await vi.waitFor(() => expect(f.extract).toHaveBeenCalledOnce())
	f.controller.abort()
	expect(signal?.aborted).toBe(true)
	expect(f.release).not.toHaveBeenCalled()
	expect(f.actor.getSnapshot().status).toBe('active')
	gate.reject(new CaptureError('canceled', 408, true))
	const response = await toPromise(f.actor)
	expect(response.status).toBe(408)
	expect(f.release).toHaveBeenCalledOnce()
})
it('returns a bounded private success response and releases its permit exactly once', async () => {
	const f = fixture()
	const response = await toPromise(f.actor)
	expect(response.status).toBe(200)
	expect(response.headers.get('Cache-Control')).toBe('private, no-store')
	expect(await response.json()).toMatchObject({
		operationId: 'operation',
		submittedUrl: parsed.url,
		finalUrl: parsed.url
	})
	expect(f.release).toHaveBeenCalledOnce()
	f.clock.increment(100)
	expect(f.release).toHaveBeenCalledOnce()
})
it('does not acquire an admission lease for an unauthorized request', async () => {
	const acquire = vi.fn(() => () => {})
	const gateway = createGatewayMachine({
		resolve: async () => ({ address: '1.1.1.1', family: 4 }),
		fetch: async () => ({
			status: 200,
			mediaType: 'text/plain',
			location: undefined,
			body: new Uint8Array()
		}),
		extract: async () => {
			throw new Error('unexpected')
		}
	})
	const actor = createActor(
		createCaptureRequestMachine({ acquire, gateway, read: async () => parsed, now: () => 0 }),
		{
			input: {
				request: new Request('https://clipper.example/api/capture/resolve'),
				accountId: undefined,
				enabled: true,
				mode: 'resolve'
			}
		}
	).start()
	expect((await toPromise(actor)).status).toBe(401)
	expect(acquire).not.toHaveBeenCalled()
})

it.each(['resolve', 'reject'] as const)(
	'drains input cancellation through %s without starting a gateway',
	async (settlement) => {
		const gate = Promise.withResolvers<CaptureInput>()
		const f = fixture({ read: () => gate.promise })
		await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce())
		f.controller.abort()
		f.actor.send({ type: 'CANCEL' })
		expect(f.actor.getSnapshot().matches({ owning: { control: 'cancelled' } })).toBe(true)
		expect(f.release).not.toHaveBeenCalled()
		if (settlement === 'resolve') gate.resolve(parsed)
		else gate.reject(new Error('aborted'))
		const response = await toPromise(f.actor)
		expect(await response.json()).toEqual({ code: 'canceled', retryable: true })
		expect(f.extract).not.toHaveBeenCalled()
		expect(f.release).toHaveBeenCalledOnce()
	}
)

it('preserves deadline precedence when cancelled input drains past the deadline', async () => {
	const gate = Promise.withResolvers<CaptureInput>()
	const f = fixture({ read: () => gate.promise })
	await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce())
	f.controller.abort()
	f.clock.increment(20)
	expect(f.actor.getSnapshot().matches({ owning: { control: 'timedOut' } })).toBe(true)
	gate.reject(new Error('aborted late'))
	const response = await toPromise(f.actor)
	expect(response.status).toBe(504)
	expect(f.release).toHaveBeenCalledOnce()
})

it('preserves a typed input failure even when the deadline expires during drain', async () => {
	const gate = Promise.withResolvers<CaptureInput>()
	const f = fixture({ read: () => gate.promise })
	await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce())
	f.clock.increment(20)
	gate.reject(new CaptureError('sourceTooLarge', 413))
	const response = await toPromise(f.actor)
	expect(response.status).toBe(413)
	expect(await response.json()).toEqual({ code: 'sourceTooLarge', retryable: false })
	expect(f.release).toHaveBeenCalledOnce()
})

it('samples an overdue deadline at the I/O boundary before a delayed timer fires', async () => {
	let now = 0
	const gate = Promise.withResolvers<CaptureInput>()
	const readClock = vi.fn(() => now)
	const f = fixture({ read: () => gate.promise, now: readClock })
	await vi.waitFor(() => expect(f.read).toHaveBeenCalledOnce())
	const calls = readClock.mock.calls.length
	const before = f.actor.getSnapshot()
	now = 21
	before.can({ type: 'CANCEL' })
	before.can({ type: 'CANCEL' })
	expect(readClock).toHaveBeenCalledTimes(calls)
	expect(f.actor.getSnapshot()).toBe(before)
	gate.resolve(parsed)
	const response = await toPromise(f.actor)
	expect(f.clock.now()).toBe(0)
	expect(response.status).toBe(504)
	expect(f.release).toHaveBeenCalledOnce()
})
