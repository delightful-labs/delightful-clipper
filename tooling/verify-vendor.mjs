import { createHash } from 'node:crypto'
import { access, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = new URL('../', import.meta.url)
/** @type {unknown} */
const manifest = JSON.parse(await readFile(new URL('vendor/manifest.json', root), 'utf8'))
if (!Array.isArray(manifest) || manifest.length === 0) throw new Error('Missing vendor manifest')

for (const entry of manifest) {
	if (
		typeof entry !== 'object' ||
		entry === null ||
		!('file' in entry) ||
		typeof entry.file !== 'string' ||
		!('sha256' in entry) ||
		typeof entry.sha256 !== 'string'
	)
		throw new Error('Invalid vendor manifest entry')
	const digest = createHash('sha256')
		.update(await readFile(new URL(`vendor/${entry.file}`, root)))
		.digest('hex')
	if (digest !== entry.sha256) throw new Error(`Vendor digest mismatch: ${entry.file}`)
}

if (process.argv.includes('--installed')) {
	const require = createRequire(new URL('apps/web/package.json', root))
	for (const name of [
		'delightful-local-first/diagnostics/logger',
		'delightful-local-first/transactions/workflow',
		'delightful-local-first/transactions/contracts',
		'delightful-local-first/lifecycle/operation/contracts',
		'delightful-local-first/lifecycle/operation/workflow',
		'delightful-local-first/worker/request/contracts',
		'delightful-local-first/worker/request/workflow',
		'delightful-local-first/worker/channel/contracts',
		'delightful-local-first/worker/channel/workflow',
		'delightful-local-first/worker/effect-drain/contracts',
		'delightful-local-first/worker/effect-drain/workflow',
		'delightful-local-first/backend/jazz/startup',
		'delightful-local-first/session/workflow',
		'delightful-local-first/backend/jazz/session',
		'delightful-local-first/backend/jazz/session-readiness',
		'delightful-local-first/backend/jazz/recovery',
		'delightful-local-first/backend/jazz/restoration'
	]) {
		await import(pathToFileURL(require.resolve(name)).href)
	}
	await access(require.resolve('delightful-ui'))
	await access(require.resolve('delightful-ui/theme.css'))
}
console.log(`Verified ${manifest.length} vendor archives in ${fileURLToPath(root)}`)
