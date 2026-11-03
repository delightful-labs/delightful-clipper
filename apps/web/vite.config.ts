import adapter from '@sveltejs/adapter-netlify'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'
import { dirname, join } from 'node:path'
import { resolveJazzWasmEntry } from 'jazz-tools/dev/vite'
import { jazzSvelteKit } from 'jazz-tools/dev/sveltekit'

const wasmEntry = resolveJazzWasmEntry()
if (!wasmEntry) throw new Error('Jazz WASM package is unavailable')

export default defineConfig(({ command }) => ({
	resolve: {
		alias: [
			{ find: /^#jazz-wasm-binary/, replacement: join(dirname(wasmEntry), 'jazz_wasm_bg.wasm') }
		]
	},
	plugins: [
		jazzSvelteKit({
			server:
				command === 'serve' &&
				process.env.npm_lifecycle_event === 'dev' &&
				process.env.CLIPPER_TEST !== 'true'
					? { port: 5174, host: '127.0.0.1', appId: '9c0871ad-3ea3-49d0-9eaf-b034914da924' }
					: false,
			appId: '9c0871ad-3ea3-49d0-9eaf-b034914da924',
			schemaDir: 'src/lib/backend/jazz',
			inspector: false
		}),
		sveltekit({ adapter: adapter(), paths: { relative: false } })
	],
	server: {
		host: '127.0.0.1',
		port: 5173,
		strictPort: true,
		...(process.env.CLIPPER_TEST === 'true' ? { fs: { allow: ['.'] } } : {})
	},
	preview: { host: '127.0.0.1', port: 4173, strictPort: true }
}))
