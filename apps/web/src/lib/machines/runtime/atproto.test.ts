import { afterEach, expect, it, vi } from 'vitest'
import { createActor, setup, waitFor, types, SimulatedClock, type ActorRefFrom } from 'xstate'
import { atprotoMachine, selectAtprotoView } from './atproto.js'
import { createServer } from 'node:http'

function fixture(
	callbackAttempt: string | null = null,
	clock?: SimulatedClock,
	now?: () => number
) {
	const redirect = vi.fn(),
		returned = vi.fn()
	const parent = setup({
		schemas: {
			events: { OAUTH_REDIRECT: types<{ url: string }>(), OAUTH_RETURNED: types<{}>() },
			children: { oauth: types<ActorRefFrom<typeof atprotoMachine>>() }
		},
		actors: { oauth: atprotoMachine }
	}).createMachine({
		invoke: {
			id: 'oauth',
			src: 'oauth',
			input: { callbackAttempt, ...(clock ? { requestTimeoutMs: 5 } : {}), ...(now ? { now } : {}) }
		},
		on: {
			OAUTH_REDIRECT: ({ event }, enq) => {
				enq(() => redirect(event.url))
			},
			OAUTH_RETURNED: (_args, enq) => {
				enq(returned)
			}
		}
	})
	const owner = createActor(parent, clock ? { clock } : {}).start()
	const actor = owner.getSnapshot().children.oauth!
	return { owner, actor, redirect, returned }
}
afterEach(() => {
	vi.unstubAllGlobals()
	vi.restoreAllMocks()
})
it('starts offline without probing auth, requesting tokens or restoring a second selection', async () => {
	const fetch = vi.fn()
	vi.stubGlobal('fetch', fetch)
	const f = fixture()
	try {
		await waitFor(f.actor, (s) => s.matches('idle'))
		expect(fetch).not.toHaveBeenCalled()
	} finally {
		f.owner.stop()
	}
})
it('requests one provider redirect, leaving account following to Jazz', async () => {
	const fetch = vi.fn(async (_path: string, _init: RequestInit) =>
		Response.json({ url: 'https://provider.example.invalid/authorize' })
	)
	vi.stubGlobal('fetch', fetch)
	const f = fixture()
	try {
		f.actor.send({ type: 'BEGIN', handle: 'derocher.me' })
		f.actor.send({ type: 'BEGIN', handle: 'ignored.example.invalid' })
		await waitFor(f.actor, (s) => s.matches('redirecting'))
		expect(f.redirect).toHaveBeenCalledExactlyOnceWith('https://provider.example.invalid/authorize')
		expect(fetch).toHaveBeenCalledOnce()
		const call = fetch.mock.calls[0]
		if (!call) throw Error('Expected authorization request')
		const [path, init] = call
		expect(path).toBe('/api/auth/sign-in/atproto')
		expect(JSON.parse(String(init.body))).toMatchObject({ handle: 'derocher.me' })
		expect(JSON.parse(String(init.body)).callbackURL).toMatch(/^\/\?atproto_attempt=[\da-f-]{36}$/)
	} finally {
		f.owner.stop()
	}
})
it.each([
	'https://provider.example.invalid/authorize',
	'http://provider.example.invalid/authorize'
])('only accepts a secure provider redirect: %s', async (url) => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ url }))
	)
	const f = fixture()
	try {
		f.actor.send({ type: 'BEGIN', handle: 'derocher.me' })
		await waitFor(f.actor, (s) => s.matches('failed') || s.matches('redirecting'))
		expect(f.redirect.mock.calls.length).toBe(url.startsWith('https:') ? 1 : 0)
	} finally {
		f.owner.stop()
	}
})
it.each([true, false])(
	'binds callback confirmation to this attempt (matching: %s)',
	async (matching) => {
		const attempt = crypto.randomUUID()
		const fetch = vi.fn(async () =>
			Response.json({
				attemptId: matching ? attempt : crypto.randomUUID(),
				userId: 'provider-user'
			})
		)
		vi.stubGlobal('fetch', fetch)
		const f = fixture(attempt)
		try {
			await waitFor(f.actor, (s) => s.matches('idle') || s.matches('completionUncertain'))
			expect(f.returned.mock.calls.length).toBe(matching ? 1 : 0)
			expect(f.redirect).not.toHaveBeenCalled()
			expect(fetch).toHaveBeenCalledOnce()
			if (!matching) expect(selectAtprotoView(f.actor.getSnapshot()).message?.variant).toBe('error')
		} finally {
			f.owner.stop()
		}
	}
)
it('cancels an outstanding provider request when its worker owner stops', async () => {
	let signal: AbortSignal | undefined
	vi.stubGlobal(
		'fetch',
		vi.fn((_path: string, init: RequestInit) => {
			signal = init.signal ?? undefined
			return new Promise<Response>(() => {})
		})
	)
	const f = fixture()
	f.actor.send({ type: 'BEGIN', handle: 'derocher.me' })
	await waitFor(f.actor, (snapshot) => snapshot.matches('authorizing'))
	expect(signal?.aborted).toBe(false)
	f.owner.stop()
	expect(signal?.aborted).toBe(true)
	expect(f.redirect).not.toHaveBeenCalled()
})

it('keeps admission probes pure and issues identity only for an accepted attempt', async () => {
	const issue = vi.spyOn(crypto, 'randomUUID')
	const fetch = vi.fn(async () =>
		Response.json({ url: 'https://provider.example.invalid/authorize' })
	)
	vi.stubGlobal('fetch', fetch)
	const f = fixture()
	try {
		expect(f.actor.getSnapshot().can({ type: 'BEGIN', handle: '  ' })).toBe(false)
		for (let probe = 0; probe < 3; probe++)
			expect(f.actor.getSnapshot().can({ type: 'BEGIN', handle: 'derocher.me' })).toBe(true)
		expect(issue).not.toHaveBeenCalled()
		expect(fetch).not.toHaveBeenCalled()
		f.actor.send({ type: 'BEGIN', handle: 'derocher.me' })
		await waitFor(f.actor, (snapshot) => snapshot.matches('redirecting'))
		expect(issue).toHaveBeenCalledOnce()
		expect(fetch).toHaveBeenCalledOnce()
	} finally {
		f.owner.stop()
		issue.mockRestore()
	}
})

it.each([
	['authorization', 'headers'],
	['authorization', 'body'],
	['completion', 'headers'],
	['completion', 'body']
] as const)(
	'bounds native %s HTTP %s waits and aborts the original request',
	async (stage, phase) => {
		const requested = Promise.withResolvers<void>(),
			receivedHeaders = Promise.withResolvers<void>(),
			closed = Promise.withResolvers<void>()
		const server = createServer((_request, response) => {
			response.on('close', () => closed.resolve())
			if (phase === 'body') {
				response.writeHead(200, { 'content-type': 'application/json' })
				response.write('{')
			}
			requested.resolve()
		})
		await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
		const address = server.address()
		if (!address || typeof address === 'string') throw new Error('Missing native fixture listener')
		const nativeFetch = globalThis.fetch
		let signal: AbortSignal | null | undefined
		vi.stubGlobal(
			'fetch',
			vi.fn(async (path: string, init: RequestInit) => {
				signal = init.signal
				const response = await nativeFetch(`http://127.0.0.1:${address.port}${path}`, init)
				receivedHeaders.resolve()
				return response
			})
		)
		const clock = new SimulatedClock(),
			attempt = crypto.randomUUID(),
			f = fixture(stage === 'completion' ? attempt : null, clock)
		try {
			if (stage === 'authorization')
				f.actor.send({ type: 'BEGIN', handle: 'reader.example.invalid' })
			await requested.promise
			if (phase === 'body') await receivedHeaders.promise
			expect(selectAtprotoView(f.actor.getSnapshot()).busy).toBe(true)
			clock.increment(5)
			expect(selectAtprotoView(f.actor.getSnapshot()).busy).toBe(false)
			expect(selectAtprotoView(f.actor.getSnapshot()).message?.variant).toBe('error')
			expect(signal?.aborted).toBe(true)
			if (stage === 'completion') {
				expect(f.actor.getSnapshot().context.callbackAttempt).toBe(attempt)
				expect(selectAtprotoView(f.actor.getSnapshot()).confirmation).toBe('uncertain')
			}
			await closed.promise
			expect(f.redirect).not.toHaveBeenCalled()
			expect(f.returned).not.toHaveBeenCalled()
		} finally {
			f.owner.stop()
			server.closeAllConnections()
			await new Promise<void>((resolve) => server.close(() => resolve()))
		}
	}
)

it('ignores a late completion result and only admits a new authorization attempt on explicit BEGIN', async () => {
	const body = Promise.withResolvers<unknown>(),
		first = new Response(),
		clock = new SimulatedClock(),
		callbackAttempt = crypto.randomUUID()
	vi.spyOn(first, 'json').mockImplementation(() => body.promise)
	const fetch = vi.fn(async () => first)
	vi.stubGlobal('fetch', fetch)
	const f = fixture(callbackAttempt, clock)
	try {
		await waitFor(f.actor, (snapshot) => snapshot.matches('completing'))
		clock.increment(5)
		body.resolve({ attemptId: callbackAttempt, userId: 'provider-user' })
		await Promise.resolve()
		await Promise.resolve()
		expect(f.actor.getSnapshot().matches('completionUncertain')).toBe(true)
		expect(f.returned).not.toHaveBeenCalled()
		expect(fetch).toHaveBeenCalledOnce()
		fetch.mockImplementation(async () =>
			Response.json({ url: 'https://provider.example.invalid/new-attempt' })
		)
		f.actor.send({ type: 'BEGIN', handle: 'reader.example.invalid' })
		await waitFor(f.actor, (snapshot) => snapshot.matches('redirecting'))
		expect(fetch).toHaveBeenCalledTimes(2)
		expect(f.redirect).toHaveBeenCalledExactlyOnceWith(
			'https://provider.example.invalid/new-attempt'
		)
	} finally {
		f.owner.stop()
		body.resolve({})
	}
})

it.each(['authorization', 'completion'] as const)(
	'refuses a late %s result when native time expires before timer delivery',
	async (stage) => {
		let now = 0
		const body = Promise.withResolvers<unknown>(),
			response = new Response(),
			clock = new SimulatedClock(),
			attempt = crypto.randomUUID()
		const decode = vi.spyOn(response, 'json').mockImplementation(() => body.promise)
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => response)
		)
		const f = fixture(stage === 'completion' ? attempt : null, clock, () => now)
		try {
			if (stage === 'authorization')
				f.actor.send({ type: 'BEGIN', handle: 'reader.example.invalid' })
			await vi.waitFor(() => expect(decode).toHaveBeenCalledOnce())
			now = 6 // Deliberately do not deliver the simulated timer.
			body.resolve(
				stage === 'authorization'
					? { url: 'https://provider.example.invalid/late' }
					: { attemptId: attempt, userId: 'provider-user' }
			)
			await waitFor(
				f.actor,
				(snapshot) => snapshot.matches('failed') || snapshot.matches('completionUncertain')
			)
			expect(selectAtprotoView(f.actor.getSnapshot()).busy).toBe(false)
			expect(f.returned).not.toHaveBeenCalled()
			expect(f.redirect).not.toHaveBeenCalled()
		} finally {
			body.resolve({})
			f.owner.stop()
		}
	}
)
