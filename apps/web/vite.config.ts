import { browserMigrations } from './tooling/browser-migrations.js'
import { offlineAssets } from './tooling/offline-assets.js'
import netlifyAdapter from '@sveltejs/adapter-netlify'
import vercelAdapter from '@sveltejs/adapter-vercel'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'
import { dirname, join } from 'node:path'
import { jazzWasmEntry as wasmEntry } from './tooling/jazz-wasm.js'
import { jazzDev } from './tooling/jazz-dev.js'
import svg from '@poppanator/sveltekit-svg'

export default defineConfig(({ command, mode }) => {
	const development =
		command === 'serve' && ['dev', 'dev:agent'].includes(process.env.npm_lifecycle_event ?? '')
	if (process.env.VERCEL || development) {
		process.env.PUBLIC_JAZZ_APP_ID ??= '9c0871ad-3ea3-49d0-9eaf-b034914da924'
		if (process.env.CLIPPER_TEST_EXTERNAL_JAZZ !== 'true' || process.env.CLIPPER_TEST !== 'true')
			process.env.PUBLIC_JAZZ_SERVER_URL = 'same-origin'
		process.env.CAPTURE_GATEWAY_ENABLED ??= 'true'
	}
	if (mode === 'agent') process.env.PUBLIC_DEBUG = 'true'
	if (mode === 'agent' || process.env.CLIPPER_TEST === 'true')
		process.env.CLIPPER_EPHEMERAL_JAZZ = 'true'
	return {
		envPrefix: ['VITE_', 'PUBLIC_'],
		// The search worker starts after account readiness. Prebundle its dependency
		// so a cold optimizer cannot trigger a late full-page reload.
		optimizeDeps: {
			exclude: ['delightful-ui', 'jazz-wasm', 'microlighter'],
			include: [
				'minisearch',
				'jazz-tools',
				'jazz-tools/client',
				'jazz-tools/local-first',
				'delightful-local-first/recovery/view',
				'delightful-local-first/forms/lifecycle',
				'delightful-local-first/diagnostics/logger',
				'delightful-local-first/backend/jazz/startup',
				'delightful-local-first/backend/jazz/session-readiness',
				'delightful-local-first/backend/jazz/recovery',
				'delightful-local-first/backend/jazz/restoration',
				'delightful-local-first/session/workflow',
				'delightful-local-first/session/sign-out/workflow',
				'delightful-local-first/restoration/workflow',
				'delightful-local-first/recovery/workflow',
				'delightful-local-first/workspace/creation/workflow',
				'delightful-local-first/transactions/workflow',
				'delightful-local-first/lifecycle/operation/workflow',
				'delightful-local-first/worker/request/workflow',
				'delightful-local-first/worker/channel/workflow',
				'delightful-local-first/worker/effect-drain/workflow'
			]
		},
		ssr: { external: ['jazz-tools', 'jazz-napi', '@vercel/functions', '@vercel/sandbox', 'ws'] },
		build: {
			// Bundle MicroLighter's lazy grammar imports into offline shell assets.
			dynamicImportVarsOptions: { exclude: [/node_modules\/(?!.*microlighter)/] }
		},
		resolve: {
			alias: [
				{ find: /^jazz-wasm$/, replacement: wasmEntry },
				{ find: /^#jazz-wasm-binary/, replacement: join(dirname(wasmEntry), 'jazz_wasm_bg.wasm') }
			]
		},
		plugins: [
			browserMigrations(process.env.CLIPPER_TEST_MIGRATIONS === 'true'),
			offlineAssets(),
			jazzDev(command === 'serve' && (development || process.env.CLIPPER_TEST === 'true')),
			sveltekit({
				adapter: process.env.VERCEL
					? vercelAdapter({ runtime: 'nodejs24.x', regions: ['iad1'], maxDuration: 300 })
					: netlifyAdapter(),
				outDir:
					command === 'serve'
						? process.env.CLIPPER_TEST === 'true'
							? process.env.CLIPPER_TEST_WORKER === 'true'
								? '.svelte-kit/e2e-worker'
								: '.svelte-kit/e2e'
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
			watch: {
				ignored: [
					'**/.clipper-dev/**',
					'**/.netlify/**',
					'**/.offline-test-builds/**',
					'**/.svelte-kit/output/**',
					'**/build/**'
				]
			},
			host: process.env.CLIPPER_TEST === 'true' ? '127.0.0.1' : '0.0.0.0',
			port: 5173,
			strictPort: true,
			...(process.env.CLIPPER_TEST === 'true'
				? {
						// The native job fixture invokes the actual extension producer/Worker.
						fs: { allow: ['.', '../extension/src'] }
					}
				: {})
		},
		preview: { host: '127.0.0.1', port: 4173, strictPort: true }
	}
})
