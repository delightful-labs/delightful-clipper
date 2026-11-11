import { expect, test } from 'vitest'
import { jazzCoreName } from './jazz-core-name.js'

const preview = {
	VERCEL_ENV: 'preview',
	VERCEL_PROJECT_ID: 'prj_9Dw5akTMo6EogWyGPHPKdOsRNWHT',
	VERCEL_GIT_COMMIT_REF: 'feat/workflow-hardening'
}

test('preview sandbox and drive names fit the deployed Vercel limit', () => {
	const name = jazzCoreName(preview)
	expect(name).toBeDefined()
	expect(`${name}-data`.length).toBeLessThanOrEqual(64)
	expect(name).toMatch(/^[a-z0-9-]+$/)
	expect(jazzCoreName({ ...preview })).toBe(name)
	expect(
		jazzCoreName({ ...preview, VERCEL_GIT_COMMIT_REF: 'feat/workflow-hardening-other' })
	).not.toBe(name)
	expect(jazzCoreName({ ...preview, VERCEL_PROJECT_ID: 'prj_other' })).not.toBe(name)
})

test('existing valid names, production stores and explicit overrides retain their identity', () => {
	expect(
		jazzCoreName({ ...preview, VERCEL_PROJECT_ID: 'p', VERCEL_GIT_COMMIT_REF: 'short' })
	).toBeUndefined()
	expect(jazzCoreName({ ...preview, VERCEL_ENV: 'production' })).toBeUndefined()
	expect(jazzCoreName({ ...preview, CLIPPER_JAZZ_CORE_NAME: 'clipper-atproto-pr32' })).toBe(
		'clipper-atproto-pr32'
	)
	expect(jazzCoreName({ VERCEL_ENV: 'preview' })).toBeUndefined()
})
