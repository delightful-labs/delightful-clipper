import { defineConfig, loadEnv } from 'vite'
import { svelte } from '@sveltejs/vite-plugin-svelte'
import { resolveJazzWasmEntry } from 'jazz-tools/dev/vite'
import { dirname, join, resolve } from 'node:path'
import { z } from 'zod'
const wasm = resolveJazzWasmEntry()
if (!wasm) throw new Error('Jazz WASM unavailable')
export default defineConfig(({ mode }) => {
	const env = {
		...loadEnv(mode, resolve('../web'), ''),
		...loadEnv(mode, process.cwd(), ''),
		...process.env
	}
	const serviceUrl = (value: string) => {
		const parsed = z.url().safeParse(value)
		if (!parsed.success) throw new Error('Invalid public extension service URL')
		const url = new URL(parsed.data)
		if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password)
			throw new Error('Invalid public extension service URL')
		if (url.protocol === 'http:' && !['127.0.0.1', 'localhost'].includes(url.hostname))
			throw new Error('Unencrypted extension services are limited to local development')
		return url
	}
	const server = serviceUrl(
		env.EXTENSION_JAZZ_SERVER_URL ?? env.PUBLIC_JAZZ_SERVER_URL ?? 'https://v2.sync.jazz.tools/'
	)
	const appId = env.EXTENSION_JAZZ_APP_ID ?? env.PUBLIC_JAZZ_APP_ID
	const localWeb: Record<string, string> = {
		'http://127.0.0.1:5174': 'http://127.0.0.1:5173/',
		'http://localhost:5174': 'http://localhost:5173/'
	}
	const web = serviceUrl(
		env.EXTENSION_WEB_URL ?? localWeb[server.origin] ?? 'https://delightful-clipper.netlify.app/'
	)
	const csp = `script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; worker-src 'self'; connect-src 'self' ${server.origin} ${server.origin.replace(/^http/, 'ws')}; base-uri 'none'; frame-ancestors 'none'`
	return {
		plugins: [
			svelte(),
			{
				name: 'clipper-extension-manifest',
				buildStart() {
					// svelte-check loads this config without building a deployable extension.
					if (!z.uuid().safeParse(appId).success)
						throw new Error('Extension requires a valid public Jazz app ID')
				},
				generateBundle() {
					this.emitFile({
						type: 'asset',
						fileName: 'manifest.json',
						source: JSON.stringify(
							{
								manifest_version: 3,
								name: 'Delightful Clipper',
								version: '0.0.2',
								permissions: ['activeTab', 'scripting', 'storage', 'offscreen'],
								action: { default_title: 'Delightful Clipper' },
								options_ui: { page: 'index.html', open_in_tab: true },
								background: { service_worker: 'background.js', type: 'module' },
								content_security_policy: { extension_pages: csp }
							},
							null,
							2
						)
					})
				}
			}
		],
		resolve: {
			alias: [
				{ find: /^#jazz-wasm-binary/, replacement: join(dirname(wasm), 'jazz_wasm_bg.wasm') },
				{ find: '$app/env/public', replacement: resolve('src/environment.ts') }
			]
		},
		define: {
			__CLIPPER_APP_ID__: JSON.stringify(appId ?? ''),
			__CLIPPER_SERVER__: JSON.stringify(server.href),
			__CLIPPER_WEB__: JSON.stringify(web.href)
		},
		worker: { format: 'es' },
		build: {
			target: 'es2023',
			rollupOptions: {
				input: {
					index: resolve('index.html'),
					runtime: resolve('runtime.html'),
					background: resolve('src/background.ts')
				},
				output: { entryFileNames: '[name].js' }
			}
		}
	}
})
