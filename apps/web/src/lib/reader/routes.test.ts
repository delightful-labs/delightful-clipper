import { spawnSync } from 'node:child_process'
import { expect, it } from 'vitest'

it('loads reader route validation directly under Node as SvelteKit does', () => {
	const result = spawnSync(
		process.execPath,
		[
			'--experimental-strip-types',
			'--input-type=module',
			'-e',
			`
		import { strict as assert } from 'node:assert'
		import { isArticleId, isArticlePath } from './src/lib/reader/routes.ts'
		assert.equal(isArticleId('ABCDEF01-2345-6789-ABCD-EF0123456789'), true)
		assert.equal(isArticleId('invalid'), false)
		assert.equal(isArticlePath('/articles/abcdef01-2345-6789-abcd-ef0123456789'), true)
	`
		],
		{
			cwd: new URL('../../../', import.meta.url),
			encoding: 'utf8',
			timeout: 10000
		}
	)
	expect(result.error).toBeUndefined()
	expect(result.status, result.stderr).toBe(0)
})
