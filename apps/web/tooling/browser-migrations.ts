import type { Plugin } from 'vite'

/** Ship the SDK's own connected fixture metadata in each browser/worker realm. */
export function browserMigrations(enabled: boolean): Plugin {
	let bundle: string | undefined
	return {
		name: 'clipper-browser-migration-fixtures',
		async configResolved() {
			if (!enabled) return
			const fixture = await import('../tests/migration-fixtures.js')
			bundle = JSON.stringify(fixture.browserMigrations)
		},
		transform(source, id) {
			if (!bundle) return
			const path = id.split('?')[0]
			if (
				!path ||
				(!path.includes('/src/lib/backend/jazz/') &&
					!path.includes('/tests/fixtures/schema-history/'))
			)
				return
			const legacy = path.endsWith('/legacy-schema.test-support.ts')
			const version =
				path.endsWith('/schema.ts') || /\/pre[a-z-]+schema\.test-support\.ts$/.test(path)
			if (!legacy && !version) return
			const name = legacy ? 'legacyApp' : 'app'
			return {
				code:
					source +
					`\nObject.defineProperty(${name}.wasmSchema, Symbol.for("jazz-tools.shippedMigrations"), {value:${bundle},configurable:true,enumerable:false,writable:false});\n`,
				map: null
			}
		}
	}
}
