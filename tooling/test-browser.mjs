import { readdirSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

// A createJazz backend belongs to its authority. Each spec owns a different
// core database, so start and drain its web backend in the same scope too.
const specs = readdirSync('apps/web/tests')
	.filter((name) => name.endsWith('.spec.ts') && name !== 'schema-upgrade.spec.ts')
	.sort()
for (const spec of specs) {
	console.info(`Browser backend scope: ${spec}`)
	const result = spawnSync(
		'pnpm',
		['exec', 'playwright', 'test', `apps/web/tests/${spec}`, ...process.argv.slice(2)],
		{ stdio: 'inherit' }
	)
	if (result.error) throw result.error
	if (result.status !== 0) {
		process.exitCode = result.status ?? 1
		break
	}
}
