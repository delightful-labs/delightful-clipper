import { afterEach, expect, it, vi } from 'vitest'
import { completionCookie, readCompletion, completedAttempt } from './completion.js'
import { handleConfiguredAuth } from './completion-handler.js'

const origin = 'https://example.invalid'
const secret = 'test-completion-secret-with-at-least-32-characters'
const attemptId = crypto.randomUUID()
const config = { origin, secret }
const cookie = () => completionCookie(attemptId, 'new-user', secret, true).split(';')[0]!
const completion = (headers: Record<string, string> = {}) =>
	new Request(origin + '/api/auth/atproto/completion', {
		method: 'POST',
		headers: { origin, cookie: cookie(), ...headers }
	})
afterEach(() => vi.useRealTimers())

it('rejects forged and expired completion receipts', () => {
	const request = (value: string) => new Request(origin, { headers: { cookie: value } })
	expect(readCompletion(request(cookie()), secret)?.attemptId).toBe(attemptId)
	expect(readCompletion(request(cookie() + 'forged'), secret)).toBeUndefined()
	expect(readCompletion(request(cookie()), 'other-secret')).toBeUndefined()
	const value = cookie()
	vi.useFakeTimers()
	vi.setSystemTime(Date.now() + 600_001)
	expect(readCompletion(request(value), secret)).toBeUndefined()
})
it('accepts only a successful same-origin callback return', () => {
	expect(
		completedAttempt(
			new Response(null, { status: 302, headers: { location: '/?atproto_attempt=' + attemptId } }),
			origin
		)
	).toBe(attemptId)
	for (const [status, location] of [
		[400, '/?atproto_attempt=' + attemptId],
		[302, 'https://other.invalid/?atproto_attempt=' + attemptId],
		[302, '/?error=failed'],
		[302, '/?atproto_attempt=invalid']
	] as const) {
		expect(
			completedAttempt(new Response(null, { status, headers: { location } }), origin)
		).toBeUndefined()
	}
})
it('requires receipt, current matching user and same-origin POST', async () => {
	const auth = {
		handler: vi.fn(),
		api: { getSession: vi.fn(async () => ({ user: { id: 'new-user' } })) }
	}
	const response = await handleConfiguredAuth(auth, completion(), config)
	expect(response.status).toBe(200)
	expect(await response.json()).toEqual({ attemptId, userId: 'new-user' })
	expect(response.headers.get('set-cookie')).toContain('Max-Age=0')
	expect(response.headers.get('cache-control')).toBe('no-store')
	expect((await handleConfiguredAuth(auth, completion({ cookie: '' }), config)).status).toBe(409)
	auth.api.getSession.mockResolvedValue({ user: { id: 'older-user' } })
	expect((await handleConfiguredAuth(auth, completion(), config)).status).toBe(409)
	expect(
		(await handleConfiguredAuth(auth, completion({ origin: 'https://other.invalid' }), config))
			.status
	).toBe(403)
	expect(
		(await handleConfiguredAuth(auth, new Request(origin + '/api/auth/atproto/completion'), config))
			.status
	).toBe(403)
})
it('reads callback identity solely from the newly issued session cookie', async () => {
	const auth = {
		handler: vi.fn(
			async () =>
				new Response(null, {
					status: 302,
					headers: {
						location: '/?atproto_attempt=' + attemptId,
						'set-cookie': 'session=new-session; HttpOnly; Path=/'
					}
				})
		),
		api: {
			getSession: vi.fn(async ({ headers }: { headers: Headers }) => ({
				user: { id: headers.get('cookie') === 'session=new-session' ? 'new-user' : 'older-user' }
			}))
		}
	}
	const response = await handleConfiguredAuth(
		auth,
		new Request(origin + '/api/auth/atproto/callback', {
			headers: { cookie: 'session=older-session' }
		}),
		config
	)
	expect(response.status).toBe(302)
	const receipt = response.headers
		.getSetCookie()
		.find((value) => value.startsWith('clipper.oauth-completion='))!
	expect(
		readCompletion(new Request(origin, { headers: { cookie: receipt.split(';')[0]! } }), secret)
	).toMatchObject({ attemptId, userId: 'new-user' })
	expect(response.headers.getSetCookie()).toContain('session=new-session; HttpOnly; Path=/')
})
it('does not mint completion when callback fails or emits no new session', async () => {
	const auth = {
		handler: vi.fn(async () => Response.json({ code: 'CALLBACK_FAILED' }, { status: 400 })),
		api: { getSession: vi.fn(async () => null) }
	}
	const response = await handleConfiguredAuth(
		auth,
		new Request(origin + '/api/auth/atproto/callback'),
		config
	)
	expect(response.status).toBe(400)
	expect(response.headers.get('set-cookie')).toBeNull()
	expect(auth.api.getSession).not.toHaveBeenCalled()
})
