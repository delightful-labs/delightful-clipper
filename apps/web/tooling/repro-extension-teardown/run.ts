import { createServer } from 'node:http'
import { mkdtemp, mkdir, cp, writeFile, rm, readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { createHash, generateKeyPairSync } from 'node:crypto'
import { dirname, join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'
import { build } from 'esbuild'
import { createJazz, memory, acceptLocalFirstAuth } from 'jazz-tools/backend'
import { app, permissions } from './schema.ts'

declare const chrome: {
	action: { onClicked: { hasListeners: () => boolean } }
	runtime: { openOptionsPage: () => Promise<void> }
}

const count = Number(process.env.CASES ?? 24)
const mode = process.env.CLOSE_MODE ?? 'abrupt'
if (!Number.isInteger(count) || count < 1 || count > 100) throw new Error('CASES must be 1–100')
if (process.env.THIN_ONLY === '1' && process.env.OFFLINE_ONLY === '1')
	throw new Error('Thin clients require a backend')
if (!['abrupt', 'unsubscribe', 'session', 'disconnect'].includes(mode))
	throw new Error('Invalid CLOSE_MODE')
const root = await mkdtemp(join(tmpdir(), 'jazz-extension-teardown-'))
const extension = join(root, 'extension')
await mkdir(extension)
const key = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({
	format: 'der',
	type: 'spki'
})
const extensionId = [...createHash('sha256').update(key).digest().subarray(0, 16)]
	.map((byte) => String.fromCharCode(97 + (byte >> 4), 97 + (byte & 15)))
	.join('')
const server = createServer((request, response) => {
	if (request.url?.startsWith('/source')) {
		response.setHeader('Content-Type', 'text/html')
		response.end('<html><body>Disposable source</body></html>')
	} else jazz.nodeHandler(request, response)
})
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
const address = server.address()
if (!address || typeof address === 'string') throw new Error('Missing fixture listener')
const origin = `http://127.0.0.1:${address.port}`
const jazz = createJazz({
	app,
	permissions,
	store: memory(),
	authenticate: acceptLocalFirstAuth,
	allowedOrigins: [`chrome-extension://${extensionId}`],
	publicUrl: origin + '/jazz'
})
let failures = 0
try {
	await jazz.attach(server)
	await jazz.ready()
	const require = createRequire(import.meta.url)
	const sdkRoot = dirname(require.resolve('jazz-tools/package.json'))
	const wasm = createRequire(join(sdkRoot, 'package.json')).resolve('jazz-wasm')
	await cp(join(dirname(wasm), 'jazz_wasm_bg.wasm'), join(extension, 'jazz_wasm_bg.wasm'))
	await cp(
		join(sdkRoot, 'dist/worker/jazz-broker-worker.js'),
		join(extension, 'jazz-broker-worker.js')
	)
	await build({
		entryPoints: [fileURLToPath(new URL('./client.ts', import.meta.url))],
		outfile: join(extension, 'client.js'),
		bundle: true,
		format: 'esm',
		platform: 'browser',
		external: ['node:*', 'jazz-napi'],
		logLevel: 'silent'
	})
	await writeFile(
		join(extension, 'manifest.json'),
		JSON.stringify({
			manifest_version: 3,
			name: 'Jazz teardown fixture',
			version: '0.0.1',
			key: key.toString('base64'),
			permissions: ['activeTab', 'scripting', 'storage'],
			action: { default_title: 'Fixture' },
			options_ui: { page: 'index.html', open_in_tab: true },
			background: { service_worker: 'background.js', type: 'module' },
			content_security_policy: {
				extension_pages: `script-src 'self' 'wasm-unsafe-eval'; object-src 'none'; worker-src 'self'; connect-src 'self' ${origin} ${origin.replace('http:', 'ws:')}`
			}
		})
	)
	await writeFile(
		join(extension, 'background.js'),
		`chrome.action.onClicked.addListener(tab => {
  chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{document.body.dataset.clicked='yes'}})
 })`
	)
	await writeFile(
		join(extension, 'index.html'),
		`<html><body>
 <script type="application/json" id="fixture-config">${JSON.stringify({
		serverUrl: process.env.OFFLINE_ONLY === '1' ? null : origin + '/jazz',
		restore: process.env.RESTORE !== '0',
		subscribe: process.env.SUBSCRIBE !== '0',
		localFirst: process.env.THIN_ONLY !== '1'
 })}</script><script type="module" src="client.js"></script></body></html>`
	)
	console.info(
		JSON.stringify({
			sdk: JSON.parse(await readFile(join(sdkRoot, 'package.json'), 'utf8')).version,
			node: process.version,
			count,
			mode,
			offline: process.env.OFFLINE_ONLY === '1'
		})
	)
	for (let index = 0; index < count; index++) {
		const context = await chromium.launchPersistentContext(join(root, 'profile-' + index), {
			channel: 'chromium',
			headless: true,
			args: [
				`--disable-extensions-except=${extension}`,
				`--load-extension=${extension}`,
				'--enable-unsafe-extension-debugging'
			]
		})
		try {
			if (index === 0) console.info('browser', context.browser()!.version())
			context.on('weberror', (event) => console.info('fixture-script-error', event.error().name))
			const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
			await worker.evaluate(() => chrome.action.onClicked.hasListeners())
			await worker.evaluate(() => chrome.runtime.openOptionsPage())
			await expect
				.poll(() => context.pages().some((page) => page.url().endsWith('/index.html')))
				.toBe(true)
			const settings = context.pages().find((page) => page.url().endsWith('/index.html'))!
			try {
				await settings.waitForFunction(() => document.body.dataset.stage === 'ready', null, {
					timeout: 20_000
				})
			} catch (error) {
				console.info(
					'fixture-setup-stage',
					await settings.evaluate(() => document.body.dataset.stage)
				)
				throw error
			}
			await settings.evaluate(async (selected) => {
				await globalThis.jazzExtensionTeardownFinish(selected)
			}, mode)
			await settings.close()
			const source = await context.newPage()
			await source.goto(origin + '/source?case=' + index)
			await source.bringToFront()
			const cdp = await context.browser()!.newBrowserCDPSession()
			try {
				const { targetInfos } = await cdp.send('Target.getTargets', {
					filter: [{ type: 'tab', exclude: false }, { exclude: true }]
				})
				const target = targetInfos.find((value) => value.url === source.url())
				if (!target) throw new Error('Missing source target')
				await cdp.send('Extensions.triggerAction', { id: extensionId, targetId: target.targetId })
			} finally {
				await cdp.detach()
			}
			try {
				await source.waitForFunction(() => document.body.dataset.clicked === 'yes', null, {
					timeout: 2000
				})
				console.info('PASS', index)
			} catch {
				failures++
				console.info('FAIL', index, 'toolbar event produced no DOM effect')
			}
		} finally {
			await context.close()
		}
	}
	console.info(JSON.stringify({ count, mode, failures }))
	process.exitCode = failures ? 1 : 0
} finally {
	server.closeAllConnections()
	await jazz.close()
	await new Promise<void>((resolve) => server.close(() => resolve()))
	await rm(root, { recursive: true, force: true })
}
