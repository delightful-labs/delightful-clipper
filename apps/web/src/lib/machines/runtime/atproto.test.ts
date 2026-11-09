import { afterEach, expect, it, vi } from 'vitest'
import { createActor, setup, waitFor } from 'xstate'
import { atprotoMachine, selectAtprotoView } from './atproto.js'

function fixture(callbackAttempt: string | null = null) {
	const redirect = vi.fn(),
		returned = vi.fn()
	type Event = { type: 'OAUTH_REDIRECT'; url: string } | { type: 'OAUTH_RETURNED' }
	const parent = setup<object, Event, { oauth: typeof atprotoMachine }>({
		actors: { oauth: atprotoMachine }
	}).createMachine({
		invoke: { id: 'oauth', src: 'oauth', input: { callbackAttempt } },
		on: {
			OAUTH_REDIRECT: { actions: ({ event }) => redirect(event.url) },
			OAUTH_RETURNED: { actions: returned }
		}
	})
	const owner = createActor(parent).start()
	const actor = owner.getSnapshot().children.oauth!
	return { owner, actor, redirect, returned }
}
afterEach(() => vi.unstubAllGlobals())
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
			await waitFor(f.actor, (s) => s.matches('idle') || s.matches('failed'))
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
	expect(signal?.aborted).toBe(false)
	f.owner.stop()
	expect(signal?.aborted).toBe(true)
	expect(f.redirect).not.toHaveBeenCalled()
})
