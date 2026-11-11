import { afterEach, expect, it, vi } from 'vitest'
import { handleConfiguredAuth } from './completion-handler.js'
import { completionCookie } from './completion.js'

const origin = 'https://example.invalid',
	config = { origin, secret: 'request-owner-fixture-secret-longer-than-32' }
const attemptId = crypto.randomUUID()
const signedCookie = () =>
	completionCookie(attemptId, 'new-user', config.secret, true).split(';')[0]!
const completion = (cookie = signedCookie(), signal?: AbortSignal) =>
	new Request(origin + '/api/auth/atproto/completion', {
		method: 'POST',
		headers: { origin, cookie },
		...(signal ? { signal } : {})
	})
const fixture = () => ({
	handler: vi.fn(async (_request: Request) => new Response('provider bytes')),
	api: {
		getSession: vi.fn(
			async (_input: { headers: Headers }): Promise<{ user: { id: string } } | null> => ({
				user: { id: 'new-user' }
			})
		)
	}
})
function callback(body?: ReadableStream<Uint8Array>) {
	const headers = new Headers({ location: '/?atproto_attempt=' + attemptId })
	headers.append('Set-Cookie', 'session=new-session; HttpOnly; Path=/')
	headers.append('Set-Cookie', 'preference=preserved; Path=/')
	return new Response(body ?? 'callback bytes', { status: 302, headers })
}
afterEach(() => vi.useRealTimers())

it('rejects an already disconnected request before any provider or session effect', async () => {
	const auth = fixture(),
		controller = new AbortController()
	controller.abort()
	await expect(
		handleConfiguredAuth(
			auth,
			new Request(origin + '/api/auth/sign-in/atproto', { signal: controller.signal }),
			config
		)
	).rejects.toMatchObject({ name: 'AbortError' })
	expect(auth.handler).not.toHaveBeenCalled()
	expect(auth.api.getSession).not.toHaveBeenCalled()
})
it('maps provider rejection to the existing sanitized failure response', async () => {
	const auth = fixture()
	auth.handler.mockRejectedValue(new Error('private provider detail'))
	const response = await handleConfiguredAuth(
		auth,
		new Request(origin + '/api/auth/atproto/callback'),
		config
	)
	expect(response.status).toBe(500)
	expect(await response.json()).toEqual({ error: 'auth_request_failed', fields: [] })
	expect(response.headers.get('set-cookie')).toBeNull()
	expect(auth.api.getSession).not.toHaveBeenCalled()
})
it('disposes a successful callback response when no newly issued session can be confirmed', async () => {
	const auth = fixture(),
		cancel = vi.fn()
	auth.handler.mockResolvedValue(callback(new ReadableStream({ cancel })))
	auth.api.getSession.mockResolvedValue(null)
	const response = await handleConfiguredAuth(
		auth,
		new Request(origin + '/api/auth/atproto/callback'),
		config
	)
	expect(response.status).toBe(409)
	expect(response.headers.get('set-cookie')).toBeNull()
	await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
})

it.each(['missing', 'forged', 'expired'] as const)(
	'rejects a %s receipt before any private session read',
	async (kind) => {
		const auth = fixture(),
			cookie = signedCookie()
		if (kind === 'expired') {
			vi.useFakeTimers()
			vi.setSystemTime(Date.now() + 600_001)
		}
		const response = await handleConfiguredAuth(
			auth,
			completion(kind === 'missing' ? '' : kind === 'forged' ? cookie + 'bad' : cookie),
			config
		)
		expect(response.status).toBe(409)
		expect(response.headers.get('set-cookie')).toBeNull()
		expect(auth.api.getSession).not.toHaveBeenCalled()
		expect(auth.handler).not.toHaveBeenCalled()
	}
)
it.each(['origin', 'method'] as const)(
	'rejects invalid %s before receipt/session/provider effects',
	async (kind) => {
		const auth = fixture(),
			request = new Request(origin + '/api/auth/atproto/completion', {
				method: kind === 'method' ? 'GET' : 'POST',
				headers: {
					origin: kind === 'origin' ? 'https://foreign.invalid' : origin,
					cookie: signedCookie()
				}
			})
		expect((await handleConfiguredAuth(auth, request, config)).status).toBe(403)
		expect(auth.api.getSession).not.toHaveBeenCalled()
		expect(auth.handler).not.toHaveBeenCalled()
	}
)
it('transfers delegated response bytes without cancelling the returned body', async () => {
	const cancel = vi.fn(),
		auth = fixture()
	let stream!: ReadableStreamDefaultController<Uint8Array>
	const response = new Response(
		new ReadableStream({
			start: (controller) => {
				stream = controller
			},
			cancel
		})
	)
	auth.handler.mockResolvedValue(response)
	const returned = await handleConfiguredAuth(auth, new Request(origin + '/api/auth/jwks'), config)
	expect(returned).toBe(response)
	expect(cancel).not.toHaveBeenCalled()
	stream.enqueue(new TextEncoder().encode('live response bytes'))
	stream.close()
	expect(await returned.text()).toBe('live response bytes')
	expect(cancel).not.toHaveBeenCalled()
	expect(auth.api.getSession).not.toHaveBeenCalled()
})
it('transfers callback body ownership and preserves every provider cookie while selecting the newly issued session', async () => {
	const cancel = vi.fn(),
		auth = fixture()
	let stream!: ReadableStreamDefaultController<Uint8Array>
	auth.handler.mockResolvedValue(
		callback(
			new ReadableStream({
				start: (controller) => {
					stream = controller
				},
				cancel
			})
		)
	)
	const returned = await handleConfiguredAuth(
		auth,
		new Request(origin + '/api/auth/atproto/callback', {
			headers: { cookie: 'session=older-session' }
		}),
		config
	)
	expect(auth.api.getSession.mock.calls[0]?.[0].headers.get('cookie')).toBe(
		'session=new-session; preference=preserved'
	)
	expect(returned.headers.getSetCookie()).toHaveLength(3)
	expect(cancel).not.toHaveBeenCalled()
	stream.enqueue(new TextEncoder().encode('callback stream bytes'))
	stream.close()
	expect(await returned.text()).toBe('callback stream bytes')
	expect(cancel).not.toHaveBeenCalled()
})
it.each(['incoming', 'issued'] as const)(
	'sanitizes %s session lookup failure without a success cookie',
	async (kind) => {
		const auth = fixture(),
			cancel = vi.fn()
		auth.api.getSession.mockRejectedValue(new Error('private credential marker'))
		auth.handler.mockResolvedValue(callback(new ReadableStream({ cancel })))
		const response = await handleConfiguredAuth(
			auth,
			kind === 'incoming' ? completion() : new Request(origin + '/api/auth/atproto/callback'),
			config
		)
		expect(response.status).toBe(500)
		expect(response.headers.get('set-cookie')).toBeNull()
		expect(await response.json()).toEqual({ error: 'auth_request_failed', fields: [] })
		if (kind === 'issued') await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
	}
)
it('aborts the delegated request and disposes a late response after disconnect', async () => {
	const pending = Promise.withResolvers<Response>(),
		controller = new AbortController(),
		auth = fixture(),
		cancel = vi.fn()
	auth.handler.mockImplementation(() => pending.promise)
	const returned = handleConfiguredAuth(
		auth,
		new Request(origin + '/api/auth/sign-in/atproto', { signal: controller.signal }),
		config
	)
	await vi.waitFor(() => expect(auth.handler).toHaveBeenCalledOnce())
	const nativeSignal = auth.handler.mock.calls[0]?.[0].signal
	controller.abort()
	await expect(returned).rejects.toMatchObject({ name: 'AbortError' })
	expect(nativeSignal?.aborted).toBe(true)
	pending.resolve(new Response(new ReadableStream({ cancel })))
	await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
	expect(auth.api.getSession).not.toHaveBeenCalled()
})
it('disposes the original callback body when disconnect interrupts an uncancellable session lookup', async () => {
	const pending = Promise.withResolvers<{ user: { id: string } }>(),
		controller = new AbortController(),
		auth = fixture(),
		cancel = vi.fn()
	auth.handler.mockResolvedValue(callback(new ReadableStream({ cancel })))
	auth.api.getSession.mockImplementation(() => pending.promise)
	const returned = handleConfiguredAuth(
		auth,
		new Request(origin + '/api/auth/atproto/callback', { signal: controller.signal }),
		config
	)
	await vi.waitFor(() => expect(auth.api.getSession).toHaveBeenCalledOnce())
	controller.abort()
	await expect(returned).rejects.toMatchObject({ name: 'AbortError' })
	pending.resolve({ user: { id: 'new-user' } })
	await vi.waitFor(() => expect(cancel).toHaveBeenCalledOnce())
})
it('does not accept a receipt that expires while its session read is pending', async () => {
	const auth = fixture(),
		pending = Promise.withResolvers<{ user: { id: string } }>()
	auth.api.getSession.mockImplementation(() => pending.promise)
	const returned = handleConfiguredAuth(auth, completion(), config)
	await vi.waitFor(() => expect(auth.api.getSession).toHaveBeenCalledOnce())
	vi.useFakeTimers()
	vi.setSystemTime(Date.now() + 600_001)
	pending.resolve({ user: { id: 'new-user' } })
	const response = await returned
	expect(response.status).toBe(409)
	expect(response.headers.get('set-cookie')).toBeNull()
})
it('passes through a malformed callback redirect without private lookup or a receipt', async () => {
	const auth = fixture(),
		response = new Response('unchanged', { status: 302, headers: { location: 'https://[' } })
	auth.handler.mockResolvedValue(response)
	expect(
		await handleConfiguredAuth(auth, new Request(origin + '/api/auth/atproto/callback'), config)
	).toBe(response)
	expect(auth.api.getSession).not.toHaveBeenCalled()
})
