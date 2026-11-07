import { generateKeyPairSync, sign } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import { authenticateGateway, externalJWTVerification } from './gateway-auth.js'

const account = '77777777-7777-4777-8777-777777777777'
const registry = 'https://registry.example.invalid/accounts'
function signedToken(issuer: string, audience = issuer) {
	const { privateKey, publicKey } = generateKeyPairSync('ed25519')
	const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
	const body =
		encode({ alg: 'EdDSA', kid: 'capture-test' }) +
		'.' +
		encode({
			sub: 'provider-user',
			iss: issuer,
			aud: audience,
			iat: Math.floor(Date.now() / 1000),
			exp: Math.floor(Date.now() / 1000) + 300
		})
	return {
		token: body + '.' + sign(null, Buffer.from(body), privateKey).toString('base64url'),
		key: { ...publicKey.export({ format: 'jwk' }), kid: 'capture-test', alg: 'EdDSA' }
	}
}
afterEach(() => vi.unstubAllGlobals())

it('admits a linked external JWT through signature verification and canonical account lookup', async () => {
	const origin = 'https://linked-capture.example.invalid'
	const { token, key } = signedToken(origin)
	const fetch = vi.fn(async (url: string | URL | Request) => {
		if (String(url) === origin + '/api/auth/jwks') return Response.json({ keys: [key] })
		if (String(url) === registry + '/login')
			return Response.json({ account, identity: { issuer: origin, subject: 'provider-user' } })
		throw new Error('Unexpected verification request')
	})
	vi.stubGlobal('fetch', fetch)
	const result = await authenticateGateway(
		new Request('https://app.example.invalid/api/capture/resolve', {
			headers: { Authorization: 'Bearer ' + token }
		}),
		{ appId: 'capture-proof', accountRegistry: registry, ...externalJWTVerification(origin) }
	)
	expect(result).toEqual({ accountId: account })
	expect(fetch).toHaveBeenCalledTimes(2)
})
it('rejects a correctly signed token with the wrong audience before registry admission', async () => {
	const origin = 'https://wrong-audience-capture.example.invalid'
	const { token, key } = signedToken(origin, 'https://other.example.invalid')
	const fetch = vi.fn(async () => Response.json({ keys: [key] }))
	vi.stubGlobal('fetch', fetch)
	const result = await authenticateGateway(
		new Request('https://app.example.invalid/api/capture/resolve', {
			headers: { Authorization: 'Bearer ' + token }
		}),
		{ appId: 'capture-proof', accountRegistry: registry, ...externalJWTVerification(origin) }
	)
	expect(result).toBeInstanceOf(Response)
	if (!(result instanceof Response)) throw new Error('Expected rejection')
	expect(result.status).toBe(401)
	expect(fetch).toHaveBeenCalledTimes(1)
})
it('does not infer external trust from an invalid or missing auth origin', () => {
	expect(externalJWTVerification(undefined)).toEqual({})
	expect(externalJWTVerification('not-a-url')).toEqual({})
})
