/// <reference types="chrome" />
import { test, expect, chromium } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { startLocalJazzServer } from 'jazz-tools/testing'
import { createServer } from 'node:http'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { app } from '../../web/src/lib/backend/jazz/schema.js'
import permissions from '../../web/src/lib/backend/jazz/permissions.js'
let authority: Awaited<ReturnType<typeof startLocalJazzServer>>
let directory: string
const startAuthority = () =>
	startLocalJazzServer({
		appId: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
		host: '127.0.0.1',
		port: 5181,
		dataDir: join(directory, 'authority'),
		schema: app,
		permissions
	})
const sourceServer = createServer((_request, response) => {
	response.setHeader('Content-Type', 'text/html; charset=utf-8')
	response.end(
		`<html><head><title>Rendered browser article</title></head><body><article><h1>Rendered browser article</h1><p id="rendered"></p>${'<p>A useful paragraph about independent local reading and browser captures. Saving the rendered document preserves its visible words, formatting and source link for later reading. café 🦊.</p>'.repeat(14)}<a href="/related">Related article</a><form><input value="DO_NOT_CAPTURE_FORM_SECRET"></form><script>document.querySelector('#rendered').textContent = 'Only present after JavaScript rendering.';</script></article></body></html>`
	)
})
test.beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'clipper-extension-'))
	authority = await startAuthority()
	await new Promise<void>((resolve) => sourceServer.listen(5230, '127.0.0.1', resolve))
})
test.afterAll(async () => {
	sourceServer.closeAllConnections()
	await authority?.stop()
	await new Promise<void>((resolve) => sourceServer.close(() => resolve()))
	if (directory) await rm(directory, { recursive: true, force: true })
})
async function extension(profile: string) {
	const path = resolve('apps/extension/dist')
	const context = await chromium.launchPersistentContext(profile, {
		channel: 'chromium',
		headless: true,
		args: [
			`--disable-extensions-except=${path}`,
			`--load-extension=${path}`,
			'--enable-unsafe-extension-debugging'
		]
	})
	const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
	await expect.poll(() => worker.evaluate(() => chrome.action.onClicked.hasListeners())).toBe(true)
	return { context, id: new URL(worker.url()).host, worker }
}
async function clip(context: BrowserContext, id: string, source: Page) {
	await source.bringToFront()
	const pages = context.pages().length
	const session = await context.browser()!.newBrowserCDPSession()
	try {
		const { targetInfos } = await session.send('Target.getTargets', {
			filter: [{ type: 'tab', exclude: false }, { exclude: true }]
		})
		const target = targetInfos.find((target) => target.url === source.url())
		if (!target) throw new Error('Missing source tab target')
		await session.send('Extensions.triggerAction', { id, targetId: target.targetId })
		await expect(source.locator('delightful-clipper-bar')).toBeVisible()
		expect(context.pages()).toHaveLength(pages)
	} finally {
		await session.detach()
	}
}
async function recovery(context: BrowserContext, id: string) {
	const page = await context.newPage()
	await page.goto(`chrome-extension://${id}/index.html`)
	await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
	const dialog = page.getByRole('dialog')
	const phrase = await dialog.getByLabel('Recovery phrase', { exact: true }).inputValue()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await page.close()
	return phrase
}
const saved = /^(Article saved on this device\. Sync pending\.|Article synced\.)$/
test('toolbar saves directly, shows a top bar, and syncs rendered content without replacing a duplicate', async ({
	browser
}) => {
	const { context, id } = await extension(join(directory, 'profile'))
	try {
		const source = await context.newPage()
		await source.goto('http://127.0.0.1:5230/article')
		await clip(context, id, source)
		await expect(source.getByRole('status')).toHaveText(saved)
		await expect(source.getByRole('link', { name: 'Open article', exact: true })).toHaveAttribute(
			'href',
			/^http:\/\/127\.0\.0\.1:5180\/articles\/[a-f0-9-]+$/
		)
		expect(
			await source
				.locator('delightful-clipper-bar')
				.evaluate((element) => element.getBoundingClientRect().top)
		).toBe(0)
		await source.screenshot({
			path: '/tmp/clipper-extension-bar-review.png',
			clip: { x: 0, y: 0, width: 1100, height: 240 }
		})
		const phrase = await recovery(context, id)
		const web = await browser.newContext()
		try {
			const reader = await web.newPage()
			let fetches = 0
			reader.on('request', (request) => {
				if (request.url().includes('/api/capture/')) fetches++
			})
			await reader.goto('/')
			await reader.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
			await reader.getByRole('button', { name: 'Restore account', exact: true }).click()
			await reader.getByRole('link', { name: 'Rendered browser article', exact: true }).click()
			await expect(
				reader.getByText('Only present after JavaScript rendering.', { exact: false })
			).toBeVisible()
			await expect(reader.locator('body')).not.toContainText('DO_NOT_CAPTURE_FORM_SECRET')
			await expect(reader.locator('body')).toContainText('café 🦊')
			await expect(reader.getByRole('link', { name: 'Related article' })).toHaveAttribute(
				'href',
				'http://127.0.0.1:5230/related'
			)
			await source.locator('#rendered').evaluate((element) => {
				element.textContent = 'Changed source must not replace the snapshot.'
			})
			await clip(context, id, source)
			await expect(source.getByRole('status')).toHaveText('Already saved.')
			await expect(source.locator('delightful-clipper-bar')).toHaveCount(1)
			await reader.reload()
			await expect(
				reader.getByText('Only present after JavaScript rendering.', { exact: false })
			).toBeVisible()
			await expect(reader.locator('body')).not.toContainText(
				'Changed source must not replace the snapshot.'
			)
			expect(fetches).toBe(0)
		} finally {
			await web.close()
		}
	} finally {
		await context.close()
	}
})

test('source messages cannot issue saves and navigation removes the old document bar', async () => {
	const { context, id, worker } = await extension(join(directory, 'security-profile'))
	try {
		const source = await context.newPage()
		await source.goto('http://127.0.0.1:5230/original')
		await clip(context, id, source)
		await expect(source.getByRole('status')).toHaveText(saved)
		await source.evaluate(() =>
			window.postMessage({ target: 'runtime', type: 'RUN', id: 'forged' }, '*')
		)
		await source.reload()
		await expect(source.locator('delightful-clipper-bar')).toHaveCount(0)
		const options = await context.newPage()
		await options.goto(`chrome-extension://${id}/index.html`)
		// Even another trusted extension page cannot impersonate the offscreen writer.
		const reply = await options.evaluate(() =>
			chrome.runtime.sendMessage({
				type: 'ISSUE',
				id: '77777777-7777-4777-8777-777777777777',
				accountId: '77777777-7777-4777-8777-777777777777'
			})
		)
		expect(reply).toEqual({ accepted: false })
		expect(
			await worker.evaluate(
				async () =>
					Object.keys(await chrome.storage.local.get(null)).filter((key) =>
						key.startsWith('clipper.capture.')
					).length
			)
		).toBe(0)
	} finally {
		await context.close()
	}
})

test('retains an issued reference across browser restart without automatically replaying it or opening a tab', async () => {
	const profile = join(directory, 'restart-profile')
	const first = await extension(profile)
	const captureId = '77777777-7777-4777-8777-777777777777'
	try {
		await first.worker.evaluate(
			async (id) =>
				chrome.storage.local.set({
					[`clipper.capture.${id}`]: {
						version: 1,
						id,
						tabId: 7,
						documentId: 'old-document',
						url: 'https://example.com/uncertain',
						phase: 'issued',
						accountId: id
					}
				}),
			captureId
		)
	} finally {
		await first.context.close()
	}
	const second = await extension(profile)
	try {
		const record = await second.worker.evaluate(
			async (id) =>
				(
					await chrome.storage.local.get<Record<string, { phase: string }>>(`clipper.capture.${id}`)
				)[`clipper.capture.${id}`]?.phase,
			captureId
		)
		expect(record).toBe('issued')
		expect(
			await second.worker.evaluate(() =>
				chrome.runtime.getContexts({
					contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
				})
			)
		).toHaveLength(0)
		expect(
			second.context.pages().every((page) => !page.url().startsWith('chrome-extension:'))
		).toBe(true)
	} finally {
		await second.context.close()
	}
})

test('saves directly offline, restarts the browser, and syncs without gateway refetching', async ({
	browser
}) => {
	test.setTimeout(90000)
	const profile = join(directory, 'offline-profile')
	const first = await extension(profile)
	let phrase = ''
	try {
		phrase = await recovery(first.context, first.id)
		const source = await first.context.newPage()
		await source.goto('http://127.0.0.1:5230/offline')
		await authority.stop()
		await clip(first.context, first.id, source)
		await expect(source.getByRole('status')).toHaveText(
			'Article saved on this device. Sync pending.'
		)
	} finally {
		await first.context.close()
	}
	const second = await extension(profile)
	const web = await browser.newContext()
	try {
		const source = await second.context.newPage()
		await source.goto('http://127.0.0.1:5230/offline')
		await clip(second.context, second.id, source)
		await expect(source.getByRole('status')).toHaveText('Already saved.')
		authority = await startAuthority()
		const reader = await web.newPage()
		let gateway = 0
		reader.on('request', (request) => {
			if (request.url().includes('/api/capture/')) gateway++
		})
		await reader.goto('/')
		await reader.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		phrase = ''
		await reader.getByRole('button', { name: 'Restore account', exact: true }).click()
		await reader.getByRole('link', { name: 'Rendered browser article', exact: true }).click()
		await expect(
			reader.getByText('Only present after JavaScript rendering.', { exact: false })
		).toBeVisible()
		expect(gateway).toBe(0)
	} finally {
		phrase = ''
		await web.close()
		await second.context.close()
	}
})

test('Close dismisses only the bar, keeps the source and saved article, and allows another toolbar click', async () => {
	const { context, id, worker } = await extension(join(directory, 'dismiss-profile'))
	try {
		const source = await context.newPage()
		await source.goto('http://127.0.0.1:5230/dismiss')
		await clip(context, id, source)
		await expect(source.getByRole('status')).toHaveText(saved)
		await source.getByRole('button', { name: 'Close', exact: true }).click()
		await expect(source.locator('delightful-clipper-bar')).toHaveCount(0)
		expect(source.url()).toBe('http://127.0.0.1:5230/dismiss')
		await clip(context, id, source)
		await expect(source.getByRole('status')).toHaveText('Already saved.')
		expect(
			await worker.evaluate(
				async () =>
					Object.keys(await chrome.storage.local.get(null)).filter((key) =>
						key.startsWith('clipper.capture.')
					).length
			)
		).toBe(0)
	} finally {
		await context.close()
	}
})

test('packages workers locally with offscreen ownership and only gesture-scoped source access', async () => {
	const manifest = JSON.parse(await readFile('apps/extension/dist/manifest.json', 'utf8'))
	expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'storage', 'offscreen'])
	expect(manifest.host_permissions).toBeUndefined()
	expect(manifest.content_scripts).toBeUndefined()
	expect(manifest.externally_connectable).toBeUndefined()
	expect(manifest.web_accessible_resources).toBeUndefined()
	expect(manifest.options_ui).toEqual({ page: 'index.html', open_in_tab: true })
	expect(manifest.content_security_policy.extension_pages).toContain(
		"script-src 'self' 'wasm-unsafe-eval'"
	)
	expect(manifest.content_security_policy.extension_pages).not.toContain("'unsafe-eval'")
	expect(
		(await readdir('apps/extension/dist/assets')).filter((name) => name.endsWith('.wasm'))
	).toHaveLength(1)
})

test('restoring an account in options moves subsequent automatic clips to that library', async ({
	browser
}) => {
	const { context, id, worker } = await extension(join(directory, 'restore-profile'))
	const web = await browser.newContext()
	try {
		const source = await context.newPage()
		await source.goto('http://127.0.0.1:5230/before-restore')
		await clip(context, id, source)
		await expect(source.getByRole('status')).toHaveText(saved)
		const previous = await worker.evaluate(
			async () =>
				(
					await chrome.runtime.getContexts({
						contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
					})
				)[0]?.contextId
		)
		const reader = await web.newPage()
		await reader.goto('/')
		await reader.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
		const recoveryDialog = reader.getByRole('dialog')
		const phrase = await recoveryDialog.getByLabel('Recovery phrase', { exact: true }).inputValue()
		await recoveryDialog.getByRole('button', { name: 'Close', exact: true }).click()
		const options = await context.newPage()
		await options.goto(`chrome-extension://${id}/index.html`)
		await options.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await options.getByRole('button', { name: 'Restore account', exact: true }).click()
		await expect
			.poll(
				async () =>
					(await worker.evaluate(
						async () =>
							(
								await chrome.runtime.getContexts({
									contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
								})
							)[0]?.contextId
					)) !== previous
			)
			.toBe(true)
		await source.goto('http://127.0.0.1:5230/after-restore')
		await clip(context, id, source)
		await expect(source.getByRole('status')).toHaveText(saved)
		await reader.reload()
		await expect(
			reader.getByRole('link', { name: 'Rendered browser article', exact: true })
		).toHaveCount(1)
		await reader.getByRole('link', { name: 'Rendered browser article', exact: true }).click()
		await expect(
			reader.getByText('Only present after JavaScript rendering.', { exact: false })
		).toBeVisible()
	} finally {
		await web.close()
		await context.close()
	}
})

test('successive toolbar clicks save different tabs through one hidden runtime', async () => {
	const { context, id, worker } = await extension(join(directory, 'queued-profile'))
	try {
		const first = await context.newPage()
		const second = await context.newPage()
		await first.goto('http://127.0.0.1:5230/rapid-first')
		await second.goto('http://127.0.0.1:5230/rapid-second')
		await clip(context, id, first)
		await clip(context, id, second)
		await expect(first.getByRole('status')).toHaveText(saved)
		await expect(second.getByRole('status')).toHaveText(saved)
		expect(
			await first.getByRole('link', { name: 'Open article', exact: true }).getAttribute('href')
		).not.toBe(
			await second.getByRole('link', { name: 'Open article', exact: true }).getAttribute('href')
		)
		expect(
			await worker.evaluate(() =>
				chrome.runtime.getContexts({
					contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT]
				})
			)
		).toHaveLength(1)
	} finally {
		await context.close()
	}
})
