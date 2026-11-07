import { handleConfiguredAuth } from './completion-handler.js'
import { readCompletion } from './completion.js'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { betterAuth } from 'better-auth'
import { memoryAdapter } from 'better-auth/adapters/memory'
import { atproto } from '@kingironman2011/better-auth-bsky'

const pluginRequire = createRequire(import.meta.resolve('@kingironman2011/better-auth-bsky'))
const oauthPath = pathToFileURL(pluginRequire.resolve('@atcute/oauth-node-client')).href
const oauth: {
	OAuthClient: {
		prototype: {
			callback: (...args: unknown[]) => Promise<unknown>
			restore: (...args: unknown[]) => Promise<unknown>
		}
	}
} = await import(oauthPath)

afterEach(() => vi.restoreAllMocks())

it('completes new-user and returning-user callbacks with the installed Better Auth adapter', async () => {
	const attemptId = crypto.randomUUID()
	const did = 'did:plc:abcdefghijklmnopqrstuvwx'
	vi.spyOn(oauth.OAuthClient.prototype, 'callback').mockResolvedValue({
		session: { did, getTokenInfo: async () => ({ aud: 'https://pds.example.invalid' }) },
		state: { callbackURL: '/?atproto_attempt=' + attemptId }
	})
	vi.spyOn(oauth.OAuthClient.prototype, 'restore').mockResolvedValue({
		handle: async () =>
			Response.json({ did, handle: 'proof.example.invalid', displayName: 'Callback proof' })
	})
	const rows: Record<string, unknown[]> = {
		user: [],
		session: [],
		account: [],
		verification: [],
		atprotoSession: [],
		atprotoState: []
	}
	const auth = betterAuth({
		baseURL: 'https://example.invalid',
		secret: 'local-callback-proof-secret-longer-than-32',
		database: memoryAdapter(rows),
		plugins: [atproto({ clientName: 'Delightful Clipper' })]
	})
	for (let attempt = 0; attempt < 2; attempt++) {
		const response = await handleConfiguredAuth(
			auth,
			new Request(
				'https://example.invalid/api/auth/atproto/callback?code=synthetic&state=synthetic&iss=https%3A%2F%2Fpds.example.invalid'
			),
			{ origin: 'https://example.invalid', secret: 'local-callback-proof-secret-longer-than-32' }
		)
		expect(response.status).toBe(302)
		expect(response.headers.get('location')).toBe('/?atproto_attempt=' + attemptId)
		expect(response.headers.getSetCookie().length).toBeGreaterThan(0)
		const receipt = response.headers
			.getSetCookie()
			.find((cookie) => cookie.startsWith('clipper.oauth-completion='))!
		expect(
			readCompletion(
				new Request('https://example.invalid', { headers: { cookie: receipt.split(';')[0]! } }),
				'local-callback-proof-secret-longer-than-32'
			)
		).toMatchObject({ attemptId })
		expect(rows.user).toHaveLength(1)
		expect(rows.account).toHaveLength(1)
		expect(rows.session).toHaveLength(attempt + 1)
	}
})
