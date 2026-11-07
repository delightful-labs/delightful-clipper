import { spawnSync } from 'node:child_process'
import { afterEach, expect, it, vi } from 'vitest'
import { previewEnvironment, provision, waitForApp } from './preview-runtime.js'

afterEach(() => {
	vi.unstubAllEnvs()
	vi.unstubAllGlobals()
})
const app = { appId: '77777777-7777-4777-8777-777777777777', adminSecret: 'test-admin-secret' }
it('replaces inherited service coordinates and strips deployment secrets from the frontend build', () => {
	for (const key of ['JAZZ_ADMIN_SECRET', 'BACKEND_SECRET', 'JAZZ_BACKEND_SECRET'])
		vi.stubEnv(key, 'production-secret')
	vi.stubEnv('PUBLIC_JAZZ_APP_ID', 'production-app')
	vi.stubEnv('JAZZ_ACCOUNT_REGISTRY', 'https://production.example/accounts')
	const env = previewEnvironment(app.appId)
	expect(env.PUBLIC_JAZZ_APP_ID).toBe(app.appId)
	expect(env.JAZZ_ACCOUNT_REGISTRY).toBe(`https://v2.sync.jazz.tools/apps/${app.appId}/accounts`)
	expect(env.PUBLIC_JAZZ_SERVER_URL).toBe('https://v2.sync.jazz.tools/')
	for (const key of ['JAZZ_ADMIN_SECRET', 'BACKEND_SECRET', 'JAZZ_BACKEND_SECRET'])
		expect(env[key]).toBeUndefined()
})
it.each([
	null,
	{},
	{ appId: 'invalid', adminSecret: 'secret' },
	{ appId: app.appId, adminSecret: '' }
])('rejects invalid provisioning response', async (body) => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json(body))
	)
	await expect(provision(new AbortController().signal)).rejects.toThrow(
		'Invalid provisioning response'
	)
})
it('accepts generated credentials and never sends an inherited bearer', async () => {
	const fetcher = vi.fn(async () => Response.json(app))
	vi.stubGlobal('fetch', fetcher)
	expect(await provision(new AbortController().signal)).toEqual(app)
	expect(fetcher.mock.calls[0]).toBeDefined()
})
it('accepts an empty schema catalog before the first permissions deployment', async () => {
	const fetcher = vi.fn(async (_url: string, _options: RequestInit) =>
		Response.json({ hashes: [], schemas: [] })
	)
	vi.stubGlobal('fetch', fetcher)
	expect(await waitForApp(app, new AbortController().signal)).toBe('ready')
	expect(fetcher).toHaveBeenCalledWith(
		`https://v2.sync.jazz.tools/apps/${app.appId}/schemas`,
		expect.objectContaining({
			headers: { 'X-Jazz-Admin-Secret': app.adminSecret },
			redirect: 'error'
		})
	)
})
it('rejects a successful response that is not a schema catalog', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ head: null }))
	)
	await expect(waitForApp(app, new AbortController().signal)).rejects.toThrow()
})
it.each([404, 502, 503, 504])('waits for cold routing after HTTP %s', async (status) => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(null, { status }))
	)
	expect(await waitForApp(app, new AbortController().signal)).toBe('pending')
})
it('stops on authorization errors instead of retrying deployment', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => new Response(null, { status: 401 }))
	)
	await expect(waitForApp(app, new AbortController().signal)).rejects.toThrow(
		'Jazz readiness request failed'
	)
})

it('loads the real Node TypeScript entry point and refuses non-preview context without provisioning', () => {
	const result = spawnSync(
		process.execPath,
		['--experimental-strip-types', 'tooling/netlify-preview.ts'],
		{
			cwd: new URL('../', import.meta.url),
			env: { ...process.env, CONTEXT: 'production' },
			encoding: 'utf8',
			timeout: 10000
		}
	)
	expect(result.error).toBeUndefined()
	expect(result.status).toBe(1)
	expect(result.stdout).toContain('"refused"')
	expect(result.stderr).toContain('refused; deployment stopped.')
	expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND')
})
