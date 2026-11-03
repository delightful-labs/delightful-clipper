import { test, expect, chromium } from '@playwright/test'
import type { Page } from '@playwright/test'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startLocalJazzServer } from 'jazz-tools/testing'
import { app } from '../../src/lib/backend/jazz/schema.js'
import permissions from '../../src/lib/backend/jazz/permissions.js'
import { staticShellServer } from './server.js'
const buildA = fileURLToPath(new URL('../../.offline-test-builds/a/', import.meta.url))
const buildB = fileURLToPath(new URL('../../.offline-test-builds/b/', import.meta.url))
const prefix = 'delightful-clipper-shell-v1-'
const ui = staticShellServer(buildA)
let authority: Awaited<ReturnType<typeof startLocalJazzServer>>,
	dataDir: string,
	authorityUp = false
async function startAuthority() {
	if (authorityUp) return
	authority = await startLocalJazzServer({
		appId: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
		host: '127.0.0.1',
		port: 5191,
		dataDir,
		schema: app,
		permissions
	})
	authorityUp = true
}
async function stopAuthority() {
	if (authorityUp) {
		await authority.stop()
		authorityUp = false
	}
}
async function clearHttpCache(page: Page) {
	const cdp = await page.context().newCDPSession(page)
	await cdp.send('Network.enable')
	await cdp.send('Network.clearBrowserCache')
	await cdp.detach()
}
async function ready(page: Page) {
	await expect(
		page.getByText('Offline startup prepared on this browser.', { exact: true })
	).toBeVisible({ timeout: 45000 })
}
async function fixtureArticle(page: Page, beforeExtract?: () => Promise<void>) {
	await page.route('**/api/capture/*', async (route) => {
		const input: { operationId: string; url: string } = route.request().postDataJSON()
		const base = { operationId: input.operationId, finalUrl: 'https://example.com/offline' }
		if (route.request().url().endsWith('/extract')) await beforeExtract?.()
		await route.fulfill({
			json: route.request().url().endsWith('/resolve')
				? base
				: {
						...base,
						provenance: {
							submittedUrl: input.url,
							redirects: [],
							resolvedAt: new Date().toISOString()
						},
						candidate: {
							title: 'Completely offline article',
							text: 'Exact offline shell text café 🦊',
							html: '<h3>Offline structure</h3><details><summary>Offline diagram</summary><svg viewBox="0 0 100 100"><title>Chart</title><path d="M0 0 L10 10" stroke="red"/></svg></details><p>Exact offline shell text café 🦊 <a href="#fn1">Citation</a></p><ol><li id="fn1">Offline footnote</li></ol>',
							assetCandidates: [],
							partialEvidence: [],
							parserVersion: 'fixture',
							normalizationVersion: '1'
						}
					}
		})
	})
}
test.beforeAll(async () => {
	dataDir = await mkdtemp(join(tmpdir(), 'clipper-offline-authority-'))
	await startAuthority()
	await ui.start()
})
test.beforeEach(async () => {
	ui.setRoot(buildA)
	ui.failRoot(false)
	ui.failWorker(false)
	ui.requests.length = 0
	await ui.start()
	await startAuthority()
})
test.afterAll(async () => {
	await ui.stop()
	await stopAuthority()
	await rm(dataDir, { recursive: true, force: true })
})

test('production shell and DLF account restart with web and Jazz servers stopped, then sync to a restored profile', async ({
	browser
}) => {
	const profile = await mkdtemp(join(tmpdir(), 'clipper-full-offline-'))
	let context = await chromium.launchPersistentContext(profile, { headless: true })
	const independent = await browser.newContext()
	try {
		const page = await context.newPage()
		await clearHttpCache(page)
		await fixtureArticle(page, stopAuthority)
		const started = performance.now()
		await page.goto('http://127.0.0.1:5190')
		await ready(page)
		const preparedMs = Math.round(performance.now() - started)
		await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
		const wasmRequests = ui.requests.filter((request) => request.path.endsWith('.wasm'))
		expect(wasmRequests).toHaveLength(1)
		console.info(
			JSON.stringify({
				coldShellPreparedMs: preparedMs,
				wasmNetworkRequests: wasmRequests.length,
				wasmBytes: wasmRequests[0]?.bytes
			})
		)
		await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
		const phrase = await page
			.getByRole('dialog')
			.getByLabel('Recovery phrase', { exact: true })
			.inputValue()
		await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
		const restored = await independent.newPage()
		await restored.goto('http://127.0.0.1:5190')
		await ready(restored)
		await restored.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await restored.getByRole('button', { name: 'Restore account', exact: true }).click()
		await expect(restored.getByText('Private library synced.', { exact: true })).toBeVisible()
		await page.getByLabel('Article URL', { exact: true }).fill('https://example.com/offline')
		await page.getByRole('button', { name: 'Add link', exact: true }).click()

		await page.evaluate(async () => {
			await fetch('/api/private-probe', { headers: { Authorization: 'Bearer private-fixture' } })
		})
		const cachePaths = await page.evaluate(async () => {
			const paths: string[] = []
			for (const name of await caches.keys())
				for (const request of await (await caches.open(name)).keys())
					paths.push(new URL(request.url).pathname)
			return paths
		})
		expect(cachePaths.every((path) => path === '/' || path.startsWith('/_app/immutable/'))).toBe(
			true
		)
		expect(cachePaths.filter((path) => path.endsWith('.wasm'))).toHaveLength(1)

		await expect(
			page.getByText('Article saved on this device. Sync pending.', { exact: true })
		).toBeVisible()
		const readerPath = await page
			.getByRole('link', { name: 'Open saved article', exact: true })
			.getAttribute('href')
		expect(readerPath).toMatch(/^\/articles\/[0-9a-f-]+$/)
		await context.close()
		await ui.stop()
		context = await chromium.launchPersistentContext(profile, { headless: true })
		await context.setOffline(true)
		const reopened = await context.newPage()
		await clearHttpCache(reopened)
		const offlineStarted = performance.now()
		const response = await reopened.goto('http://127.0.0.1:5190' + readerPath)
		expect(response?.fromServiceWorker()).toBe(true)
		await ready(reopened)
		await expect(reopened.getByRole('article')).toContainText('Exact offline shell text café 🦊')
		await expect(
			reopened.getByRole('article').getByRole('heading', { name: 'Offline structure' })
		).toBeVisible()
		await reopened.getByRole('article').locator('summary').click()
		await expect(reopened.getByRole('article').locator('svg')).toBeVisible()
		await expect(reopened.getByRole('article').locator('path')).toHaveAttribute('stroke', 'red')
		await reopened.getByRole('article').getByRole('link', { name: 'Citation', exact: true }).click()
		await expect(reopened.getByRole('article').locator('li')).toBeFocused()

		console.info(
			JSON.stringify({
				offlineColdReaderMs: Math.round(performance.now() - offlineStarted),
				webServerStopped: true,
				jazzServerStopped: true,
				httpCacheCleared: true
			})
		)
		await context.setOffline(false)
		await ui.start()
		await startAuthority()
		const sourceReload = await reopened.reload()
		expect(sourceReload?.status()).toBe(200)
		expect(sourceReload?.fromServiceWorker()).toBe(true)
		await restored.reload()
		await restored
			.getByRole('region', { name: 'Saved articles' })
			.getByRole('link', { name: 'Completely offline article', exact: true })
			.click({ timeout: 30000 })
		await expect(restored.getByRole('article')).toContainText('Exact offline shell text café 🦊')
		await restored.getByRole('article').locator('summary').click()
		await expect(restored.getByRole('article').locator('svg')).toBeVisible()
		await expect(restored.getByRole('article').locator('path')).toHaveAttribute('stroke', 'red')
		await expect(
			restored.getByRole('article').getByRole('heading', { name: 'Offline structure' })
		).toBeVisible()
	} finally {
		await independent.close()
		await context.close()
		await rm(profile, { recursive: true, force: true })
		await ui.start()
		await startAuthority()
	}
})

test('updates wait for all old tabs, reuse immutable bytes and delete only obsolete shell caches', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'clipper-shell-update-'))
	const context = await chromium.launchPersistentContext(profile, { headless: true })
	try {
		const page = await context.newPage()
		await page.goto('http://127.0.0.1:5190')
		await ready(page)
		const second = await context.newPage()
		await second.goto('http://127.0.0.1:5190')
		await ready(second)
		await page.evaluate(async () => {
			await (await caches.open('unrelated-cache')).put('/unrelated', new Response('keep'))
		})
		const wasmBefore = ui.requests.filter((request) => request.path.endsWith('.wasm')).length
		ui.setRoot(buildB)
		await page.evaluate(async () => {
			await (await navigator.serviceWorker.getRegistration())?.update()
		})
		await expect(
			page.getByText('An update is ready. Close all Clipper tabs and reopen to apply it safely.', {
				exact: true
			})
		).toBeVisible({ timeout: 45000 })
		const before = await page.evaluate(() => caches.keys())
		expect(before).toEqual(
			expect.arrayContaining([prefix + 'offline-a', prefix + 'offline-b', 'unrelated-cache'])
		)
		expect(ui.requests.filter((request) => request.path.endsWith('.wasm'))).toHaveLength(wasmBefore)
		await page.evaluate(async () => {
			;(await navigator.serviceWorker.getRegistration())?.waiting?.postMessage({
				type: 'ACTIVATE_UPDATE'
			})
		})
		await page.close()
		expect(
			await second.evaluate(
				async () => !!(await navigator.serviceWorker.getRegistration())?.waiting
			)
		).toBe(true)
		await second.close()
		const next = await context.newPage()
		await next.goto('http://127.0.0.1:5190')
		await ready(next)
		await expect.poll(() => next.evaluate(() => caches.keys())).not.toContain(prefix + 'offline-a')
		expect(await next.evaluate(() => caches.keys())).toEqual(
			expect.arrayContaining([prefix + 'offline-b', 'unrelated-cache'])
		)
	} finally {
		await context.close()
		await rm(profile, { recursive: true, force: true })
	}
})

test('failed update installation discards its partial cache and keeps the old build readable offline', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'clipper-shell-failure-'))
	const context = await chromium.launchPersistentContext(profile, { headless: true })
	try {
		const page = await context.newPage()
		await page.goto('http://127.0.0.1:5190')
		await ready(page)
		ui.setRoot(buildB)
		ui.failRoot(true)
		await page.evaluate(async () => {
			const registration = await navigator.serviceWorker.getRegistration()
			if (!registration) throw new Error('Missing registration')
			await new Promise<void>((resolve, reject) => {
				registration.addEventListener(
					'updatefound',
					() => {
						const worker = registration.installing
						if (!worker) {
							reject(new Error('Missing installer'))
							return
						}
						worker.addEventListener('statechange', () => {
							if (worker.state === 'redundant') resolve()
						})
					},
					{ once: true }
				)
				void registration.update().catch(reject)
			})
		})
		expect(await page.evaluate(() => caches.keys())).toContain(prefix + 'offline-a')
		expect(await page.evaluate(() => caches.keys())).not.toContain(prefix + 'offline-b')
		await context.setOffline(true)
		await clearHttpCache(page)
		expect((await page.reload())?.fromServiceWorker()).toBe(true)
		await ready(page)
		await expect(page.getByRole('region', { name: 'Saved articles' })).toBeVisible()
	} finally {
		await context.close()
		await rm(profile, { recursive: true, force: true })
		ui.failRoot(false)
	}
})

test('production outputs contain only one WASM binary per build', async () => {
	for (const root of [buildA, buildB]) {
		const names = await readdir(root, { recursive: true })
		expect(names.filter((name) => name.endsWith('.wasm'))).toHaveLength(1)
	}
})

test('first-install failure admits the DLF account path and retry prepares offline startup without replacing it', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'clipper-offline-retry-'))
	const context = await chromium.launchPersistentContext(profile, { headless: true })
	try {
		ui.failWorker(true)
		const page = await context.newPage()
		await page.goto('http://127.0.0.1:5190')
		await expect(
			page.getByText('Offline startup could not be prepared. You can continue online and retry.', {
				exact: true
			})
		).toBeVisible({ timeout: 45000 })
		await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
		expect((await page.evaluate(() => caches.keys())).some((name) => name.startsWith(prefix))).toBe(
			false
		)
		ui.failWorker(false)
		await page.getByRole('button', { name: 'Retry', exact: true }).click()
		await ready(page)
		await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
		await expect(page.getByRole('button', { name: 'Create account', exact: true })).toHaveCount(0)
	} finally {
		ui.failWorker(false)
		await context.close()
		await rm(profile, { recursive: true, force: true })
	}
})
