import { afterEach, expect, test, vi } from 'vitest'
import { handleAuth } from './handler.js'
import { authConfiguration } from './server.js'

afterEach(() => vi.unstubAllEnvs())

test('configuration diagnostics expose setting names without credential values', async () => {
	vi.stubEnv('AUTH_BASE_URL', 'not-an-origin')
	vi.stubEnv('AUTH_SECRET', 'private-marker')
	const response = await handleAuth(new Request('https://example.invalid/api/auth/jwks'))
	const text = await response.text()
	expect(response.status).toBe(503)
	expect(response.headers.get('cache-control')).toBe('no-store')
	expect(JSON.parse(text)).toEqual({
		error: 'invalid_auth_configuration',
		fields: ['AUTH_BASE_URL', 'AUTH_SECRET']
	})
	expect(text).not.toContain('private-marker')
	expect(text).not.toContain('not-an-origin')
})

test('a copied origin URL may include its trailing slash', () => {
	const result = authConfiguration.parse({
		origin: 'https://example.invalid/',
		secret: 'a'.repeat(32)
	})
	expect(result.origin).toBe('https://example.invalid')
})
