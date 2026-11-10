import { afterEach, expect, it, vi } from 'vitest'
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
afterEach(() => vi.unstubAllGlobals())

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
			request: (path = '/get-session', body?: { token?: string }) =>
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

for (const outcome of ['rotated', 'revoked'])
	it(`persists the provider's ${outcome} refresh outcome through the native adapter and backend restart`, async () => {
		const issuer = 'https://issuer.example.invalid'
		const pds = 'https://pds.example.invalid'
		const did = 'did:plc:abcdefghijklmnopqrstuvwx'
		let refreshes = 0
		vi.stubGlobal(
			'fetch',
			vi.fn<typeof fetch>(async (input, init) => {
				const request = new Request(input, init)
				if (request.url === issuer + '/.well-known/oauth-authorization-server')
					return Response.json({
						issuer,
						authorization_endpoint: issuer + '/authorize',
						token_endpoint: issuer + '/token',
						pushed_authorization_request_endpoint: issuer + '/par',
						revocation_endpoint: issuer + '/revoke',
						scopes_supported: ['atproto'],
						response_types_supported: ['code'],
						grant_types_supported: ['authorization_code', 'refresh_token'],
						token_endpoint_auth_methods_supported: ['none'],
						dpop_signing_alg_values_supported: ['ES256'],
						code_challenge_methods_supported: ['S256'],
						authorization_response_iss_parameter_supported: true,
						client_id_metadata_document_supported: true,
						require_pushed_authorization_requests: true
					})
				if (request.url === 'https://plc.directory/' + encodeURIComponent(did))
					return Response.json({
						'@context': ['https://www.w3.org/ns/did/v1'],
						id: did,
						alsoKnownAs: ['at://fixture.example.invalid'],
						service: [
							{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: pds }
						]
					})
				if (request.url === pds + '/.well-known/oauth-protected-resource')
					return Response.json({ resource: pds, authorization_servers: [issuer] })
				if (request.url === 'https://fixture.example.invalid/.well-known/atproto-did')
					return new Response(did)
				if (
					request.url ===
					'https://cloudflare-dns.com/dns-query?name=_atproto.fixture.example.invalid&type=TXT'
				)
					return Response.json({ Status: 0, Answer: [{ type: 16, data: '"did=' + did + '"' }] })
				if (request.url === issuer + '/token') {
					const body = new URLSearchParams(await request.text())
					expect(body.get('grant_type')).toBe('refresh_token')
					expect(body.get('refresh_token') === 'fixture-refresh-before').toBe(true)
					expect(request.headers.has('DPoP')).toBe(true)
					refreshes++
					if (outcome === 'revoked')
						return Response.json({ error: 'invalid_grant' }, { status: 400 })
					return Response.json({
						token_type: 'DPoP',
						access_token: 'fixture-access-after',
						refresh_token: 'fixture-refresh-after',
						scope: 'atproto',
						sub: did,
						expires_in: 3600
					})
				}
				throw new Error('Unexpected fixture provider request')
			})
		)
		const auth = await fixture()
		try {
			const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, [
				'sign',
				'verify'
			])
			await auth
				.db()
				.insert(app.better_auth_atprotoSession, {
					did,
					userId: auth.userId,
					handle: 'fixture.example.invalid',
					pdsUrl: pds,
					updatedAt: new Date(),
					sessionData: JSON.stringify({
						dpopKey: { ...(await crypto.subtle.exportKey('jwk', keys.privateKey)), alg: 'ES256' },
						authMethod: { method: 'none' },
						tokenSet: {
							iss: issuer,
							sub: did,
							aud: pds,
							scope: 'atproto',
							token_type: 'DPoP',
							access_token: 'fixture-access-before',
							refresh_token: 'fixture-refresh-before',
							expires_at: Date.now() - 60000
						}
					})
				})
				.wait({ tier: 'global' })
			await auth.reopen()
			const restored = await auth.request('/atproto/restore', {})
			expect(restored.status).toBe(200)
			expect(await restored.json()).toMatchObject({ active: outcome === 'rotated' })
			expect(refreshes).toBe(1)
			await auth.reopen()
			const rows = await auth.db().all(app.better_auth_atprotoSession.where({ did }))
			if (outcome === 'revoked') expect(rows).toHaveLength(0)
			else {
				expect(rows).toHaveLength(1)
				const stored = z
					.object({ tokenSet: z.object({ access_token: z.string(), refresh_token: z.string() }) })
					.parse(JSON.parse(rows[0]!.sessionData))
				expect(stored.tokenSet.access_token === 'fixture-access-after').toBe(true)
				expect(stored.tokenSet.refresh_token === 'fixture-refresh-after').toBe(true)
			}
			const again = await auth.request('/atproto/restore', {})
			expect(await again.json()).toMatchObject({ active: outcome === 'rotated' })
			expect(refreshes).toBe(1)
			expect(
				sessionResponse.parse(await (await auth.request()).json()).user.id === auth.userId
			).toBe(true)
		} finally {
			await auth.close()
		}
	})
