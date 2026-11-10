import { afterEach, expect, it, vi } from 'vitest'
import { createActor, setup, waitFor, types, type ActorRefFrom } from 'xstate'
import { atprotoMachine, selectAtprotoView } from './atproto.js'

function fixture(callbackAttempt: string | null = null) {
	const redirect = vi.fn(),
		returned = vi.fn()
	const parent = setup({
		schemas: {
			events: { OAUTH_REDIRECT: types<{ url: string }>(), OAUTH_RETURNED: types<{}>() },
			children: { oauth: types<ActorRefFrom<typeof atprotoMachine>>() }
		},
		actors: { oauth: atprotoMachine }
	}).createMachine({
		invoke: { id: 'oauth', src: 'oauth', input: { callbackAttempt } },
		on: {
			OAUTH_REDIRECT: ({ event }, enq) => {
				enq(() => redirect(event.url))
			},
			OAUTH_RETURNED: (_args, enq) => {
				enq(returned)
			}
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
