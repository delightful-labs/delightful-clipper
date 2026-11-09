import { handleConfiguredAuth } from './completion-handler.js'
import { readCompletion } from './completion.js'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJazz, sqlite } from 'jazz-tools/backend'
import { createAuthServer } from './server.js'
import { app } from '../../backend/jazz/schema.js'
import permissions from '../../backend/jazz/permissions.js'

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

it('persists callback users and sessions in Jazz across backend restart', async () => {
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
	const directory = await mkdtemp(join(tmpdir(), 'clipper-auth-'))
	const store = () => createJazz({ app, permissions, store: sqlite({ path: directory }) })
	let jazz = store()
	let auth = createAuthServer(
		{ db: () => jazz.db, schema: app },
		{
			origin: 'https://example.invalid',
			secret: 'local-callback-proof-secret-longer-than-32'
		}
	)
	try {
		for (let attempt = 0; attempt < 2; attempt++) {
			if (attempt > 0) {
				await jazz.close()
				jazz = store()
				auth = createAuthServer(
					{ db: () => jazz.db, schema: app },
					{
						origin: 'https://example.invalid',
						secret: 'local-callback-proof-secret-longer-than-32'
					}
				)
			}
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
			expect(await jazz.db.all(app.better_auth_user)).toHaveLength(1)
			expect(await jazz.db.all(app.better_auth_account)).toHaveLength(1)
			expect(await jazz.db.all(app.better_auth_session)).toHaveLength(attempt + 1)
		}
	} finally {
		await jazz.close()
		await rm(directory, { recursive: true, force: true })
	}
})
