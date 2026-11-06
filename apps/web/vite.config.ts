import { offlineAssets } from './tooling/offline-assets.js'
import adapter from '@sveltejs/adapter-netlify'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'
import { dirname, join } from 'node:path'
import { resolveJazzWasmEntry } from 'jazz-tools/dev/vite'
import { jazzSvelteKit } from 'jazz-tools/dev/sveltekit'
import svg from '@poppanator/sveltekit-svg'

const wasmEntry = resolveJazzWasmEntry()
if (!wasmEntry) throw new Error('Jazz WASM package is unavailable')

export default defineConfig(({ command, mode }) => {
	if (
		command === 'serve' &&
		['dev', 'dev:agent'].includes(process.env.npm_lifecycle_event ?? '') &&
		process.env.CLIPPER_TEST !== 'true'
	) {
		const appId =
			mode === 'agent'
				? '8d217851-cec3-4c24-a595-d130259d497c'
				: '9c0871ad-3ea3-49d0-9eaf-b034914da924'
		// Jazz's env-file precedence otherwise overrides the configured agent namespace.
		process.env.PUBLIC_JAZZ_APP_ID = appId
		process.env.JAZZ_ACCOUNT_REGISTRY = `http://127.0.0.1:${mode === 'agent' ? 5181 : 5174}/apps/${appId}/accounts`
	}
	return {
		optimizeDeps: { exclude: ['delightful-ui'] },
		resolve: {
			alias: [
				{ find: /^#jazz-wasm-binary/, replacement: join(dirname(wasmEntry), 'jazz_wasm_bg.wasm') }
			]
		},
		plugins: [
			offlineAssets(),
			jazzSvelteKit({
				server:
					command === 'serve' &&
					['dev', 'dev:agent'].includes(process.env.npm_lifecycle_event ?? '') &&
					process.env.CLIPPER_TEST !== 'true'
						? {
								port: mode === 'agent' ? 5181 : 5174,
								host: '127.0.0.1',
								appId:
									mode === 'agent'
										? '8d217851-cec3-4c24-a595-d130259d497c'
										: '9c0871ad-3ea3-49d0-9eaf-b034914da924',
								inMemory: mode === 'agent'
							}
						: false,
				appId:
					mode === 'agent'
						? '8d217851-cec3-4c24-a595-d130259d497c'
						: '9c0871ad-3ea3-49d0-9eaf-b034914da924',
				schemaDir: 'src/lib/backend/jazz',
				inspector: false
			}),
			sveltekit({
				adapter: adapter(),
				outDir:
					command === 'serve'
						? process.env.CLIPPER_TEST === 'true'
							? '.svelte-kit/e2e'
							: mode === 'agent'
								? '.svelte-kit/agent'
								: '.svelte-kit/local'
						: '.svelte-kit',
				paths: { relative: false },
				serviceWorker: { register: false },
				...(process.env.CLIPPER_SHELL_VERSION
					? { version: { name: process.env.CLIPPER_SHELL_VERSION } }
					: {})
			}),
			svg()
		],
		server: {
			host: '127.0.0.1',
			port: 5173,
			strictPort: true,
			...(process.env.CLIPPER_TEST === 'true' ? { fs: { allow: ['.'] } } : {})
		},
		preview: { host: '127.0.0.1', port: 4173, strictPort: true }
	}
})
