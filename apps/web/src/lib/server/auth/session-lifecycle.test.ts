import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeSignature } from 'better-auth/crypto'
import { createJazz, sqlite } from 'jazz-tools/backend'
import { z } from 'zod'
import { app } from '../../backend/jazz/schema.js'
import permissions from '../../backend/jazz/permissions.js'
import { createAuthServer } from './server.js'

const origin = 'https://example.invalid'
const secret = 'local-session-lifecycle-proof-longer-than-32'
const sessionResponse = z.object({
	user: z.object({ id: z.string() }),
	session: z.object({ expiresAt: z.coerce.date() })
})

async function fixture() {
	const directory = await mkdtemp(join(tmpdir(), 'clipper-auth-lifecycle-'))
	const open = () => createJazz({ app, permissions, store: sqlite({ path: directory }) })
	let jazz = open()
	const configure = () => createAuthServer({ db: () => jazz.db, schema: app }, { origin, secret })
	let auth = configure()
	try {
		const context = await auth.$context
		const user = await context.internalAdapter.createUser(
			{ name: 'Lifecycle fixture', email: 'lifecycle@example.invalid', emailVerified: true },
			{ method: 'oauth', oauth: { providerId: 'atproto', profile: { did: 'did:plc:lifecycle' } } }
		)
		const session = await context.internalAdapter.createSession(user.id)
		const cookie =
			context.authCookies.sessionToken.name +
			'=' +
			encodeURIComponent(session.token + '.' + (await makeSignature(session.token, secret)))
		return {
			userId: user.id,
			session,
			config: context.sessionConfig,
			db: () => jazz.db,
			request: (path = '/get-session', body?: { token: string }) =>
				auth.handler(
					new Request(origin + '/api/auth' + path, {
						method: body ? 'POST' : 'GET',
						headers: { cookie, origin, 'Content-Type': 'application/json' },
						...(body ? { body: JSON.stringify(body) } : {})
					})
				),
			reopen: async () => {
				await jazz.close()
				jazz = open()
				auth = configure()
			},
			close: async () => {
				await jazz.close()
				await rm(directory, { recursive: true, force: true })
			}
		}
	} catch (error) {
		await jazz.close()
		await rm(directory, { recursive: true, force: true })
		throw error
	}
}

it('renews a due native session and retains its identity and renewed expiry after backend restart', async () => {
	const auth = await fixture()
	try {
		const dueExpiry = new Date(
			Date.now() + (auth.config.expiresIn - auth.config.updateAge - 60) * 1000
		)
		await auth
			.db()
			.update(app.better_auth_session, auth.session.id, { expiresAt: dueExpiry })
			.wait({ tier: 'global' })
		await auth.reopen()
		const response = await auth.request()
		expect(response.status).toBe(200)
		const renewed = sessionResponse.parse(await response.json())
		expect(renewed.user.id === auth.userId).toBe(true)
		expect(renewed.session.expiresAt.getTime()).toBeGreaterThan(dueExpiry.getTime())
		expect(response.headers.getSetCookie().length).toBeGreaterThan(0)
		await auth.reopen()
		const reopened = sessionResponse.parse(await (await auth.request()).json())
		expect(reopened.user.id === auth.userId).toBe(true)
		expect(reopened.session.expiresAt.getTime()).toBe(renewed.session.expiresAt.getTime())
	} finally {
		await auth.close()
	}
})

for (const outcome of ['expired', 'revoked'])
	it(`rejects a ${outcome} native session after backend restart without removing its user`, async () => {
		const auth = await fixture()
		try {
			expect((await auth.request()).status).toBe(200)
			if (outcome === 'expired')
				await auth
					.db()
					.update(app.better_auth_session, auth.session.id, {
						expiresAt: new Date(Date.now() - 60000)
					})
					.wait({ tier: 'global' })
			else {
				const revoked = await auth.request('/revoke-session', { token: auth.session.token })
				expect(revoked.status).toBe(200)
			}
			await auth.reopen()
			const response = await auth.request()
			expect(response.status).toBe(200)
			expect(await response.json()).toBeNull()
			expect(await auth.db().one(app.better_auth_user.where({ id: auth.userId }))).not.toBeNull()
		} finally {
			await auth.close()
		}
	})
