/// <reference types="chrome" />
import { test, expect, chromium } from '@playwright/test'
import type { BrowserContext, Page } from '@playwright/test'
import { startLocalJazzServer } from 'jazz-tools/testing'
import { createServer } from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
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
	response.setHeader('Content-Type', 'text/html')
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
	return { context, id: new URL(worker.url()).host }
}
async function clip(context: BrowserContext, id: string, source: Page) {
	await source.bringToFront()
	const session = await context.browser()!.newBrowserCDPSession()
	const { targetInfos } = await session.send('Target.getTargets', {
		filter: [{ type: 'tab', exclude: false }, { exclude: true }]
	})
	const target = targetInfos.find((target) => target.url === source.url())
	if (!target) throw new Error('Missing source tab target')
	const opened = context.waitForEvent('page', { timeout: 10000 })
	await session.send('Extensions.triggerAction', { id, targetId: target.targetId })
	const page = await opened
	await page.waitForLoadState()
	return page
}
test('clips a rendered page through the real toolbar action and syncs supplied content to a restored web account', async ({
	browser
}) => {
	const profile = join(directory, 'profile')
	const { context, id } = await extension(profile)
	try {
		const source = await context.newPage()
		await source.goto('http://127.0.0.1:5230/article')
		const page = await clip(context, id, source)
		const errors: string[] = []
		page.on('pageerror', (error) => errors.push(error.message))
		await expect(page.getByRole('button', { name: 'Save article', exact: true })).toBeVisible()
		await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
		const dialog = page.getByRole('dialog')
		const phrase = await dialog.getByLabel('Recovery phrase', { exact: true }).inputValue()
		await dialog.getByRole('button', { name: 'Close', exact: true }).click()
		await page.getByRole('button', { name: 'Save article', exact: true }).click()
		await expect(
			page.getByText(/^(Article saved on this device\. Sync pending\.|Article synced\.)$/)
		).toBeVisible()
		await page.screenshot({ path: '/tmp/clipper-extension-review.png', fullPage: true })
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
			await expect(reader.getByRole('link', { name: 'Related article' })).toHaveAttribute(
				'href',
				'http://127.0.0.1:5230/related'
			)
			expect(fetches).toBe(0)
			await source.locator('#rendered').evaluate((element) => {
				element.textContent = 'Changed source must not replace the snapshot.'
			})
			const duplicate = await clip(context, id, source)
			await duplicate.getByRole('button', { name: 'Save article', exact: true }).click()
			await expect(duplicate.getByText('Already saved.', { exact: true })).toBeVisible()
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
		expect(errors).toEqual([])
	} finally {
		await context.close()
	}
})

test('rejects untrusted messages and changed documents without capturing another page', async () => {
	const { context, id } = await extension(join(directory, 'security-profile'))
	try {
		const source = await context.newPage()
		await source.goto('http://127.0.0.1:5230/original')
		const page = await clip(context, id, source)
		await expect(page.getByRole('button', { name: 'Save article', exact: true })).toBeVisible()
		const captureId = new URL(page.url()).hash.slice(1)
		await source.reload()
		// A same-URL reload changes document identity. Its old reference must not authorize capture.
		const result = await page.evaluate(async (captureId) => {
			const api = chrome
			const reply = await api.runtime.sendMessage({ type: 'CAPTURE', id: captureId })
			return { captured: !!reply.source, url: reply.capture?.url }
		}, captureId)
		expect(result).toEqual({ captured: false, url: 'http://127.0.0.1:5230/original' })
		await source.evaluate(() =>
			window.postMessage({ type: 'CAPTURE', id: 'forged', secret: 'untrusted' }, '*')
		)
		await expect(page.getByRole('button', { name: 'Save article', exact: true })).toBeVisible()
	} finally {
		await context.close()
	}
})

test('retains an issued capture across a full browser restart and never automatically replays it', async () => {
	const profile = join(directory, 'restart-profile')
	const first = await extension(profile)
	let captureId: string
	let url: string
	try {
		const source = await first.context.newPage()
		await source.goto('http://127.0.0.1:5230/restart')
		const page = await clip(first.context, first.id, source)
		await expect(page.getByRole('button', { name: 'Save article', exact: true })).toBeVisible()
		url = page.url()
		captureId = new URL(url).hash.slice(1)
		const worker = first.context.serviceWorkers()[0]!
		await worker.evaluate(async (id) => {
			const api = chrome
			const key = `clipper.capture.${id}`
			const record = (await api.storage.local.get<Record<string, Record<string, unknown>>>(key))[
				key
			]
			await api.storage.local.set({
				[key]: { ...record, phase: 'issued', accountId: '77777777-7777-4777-8777-777777777777' }
			})
		}, captureId)
	} finally {
		await first.context.close()
	}
	const second = await extension(profile)
	try {
		const page = await second.context.newPage()
		await page.goto(url!)
		await expect(
			page.getByText(
				'Save outcome is uncertain. Check the saved article before trying again. No write was replayed.',
				{ exact: true }
			)
		).toBeVisible()
		await expect(page.getByRole('button', { name: 'Save article', exact: true })).toHaveCount(0)
		// Restoring the pending record did not clear the non-replay marker.
		const record = await second.context.serviceWorkers()[0]!.evaluate(async (id) => {
			const api = chrome
			return (
				await api.storage.local.get<Record<string, { phase: string }>>(`clipper.capture.${id}`)
			)[`clipper.capture.${id}`]?.phase
		}, captureId!)
		expect(record).toBe('issued')
	} finally {
		await second.context.close()
	}
})

test('saves rendered content with the authority offline, restarts the entire browser, and syncs without refetching', async ({
	browser
}) => {
	test.setTimeout(90000)
	const profile = join(directory, 'offline-profile')
	const first = await extension(profile)
	let phrase = ''
	try {
		const source = await first.context.newPage()
		await source.goto('http://127.0.0.1:5230/offline')
		const page = await clip(first.context, first.id, source)
		await expect(page.getByRole('button', { name: 'Save article', exact: true })).toBeVisible()
		await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
		const dialog = page.getByRole('dialog')
		phrase = await dialog.getByLabel('Recovery phrase', { exact: true }).inputValue()
		await dialog.getByRole('button', { name: 'Close', exact: true }).click()
		await authority.stop()
		await page.getByRole('button', { name: 'Save article', exact: true }).click()
		await expect(
			page.getByText('Article saved on this device. Sync pending.', { exact: true })
		).toBeVisible()
	} finally {
		await first.context.close()
	}
	const second = await extension(profile)
	const web = await browser.newContext()
	try {
		const local = await second.context.newPage()
		await local.goto(`chrome-extension://${second.id}/index.html`)
		await expect(
			local.getByRole('button', { name: 'Show recovery phrase', exact: true })
		).toBeVisible()
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

test('dismisses an unsubmitted clip without saving or retaining its source reference', async () => {
	const { context, id } = await extension(join(directory, 'dismiss-profile'))
	try {
		const source = await context.newPage()
		await source.goto('http://127.0.0.1:5230/dismiss')
		const page = await clip(context, id, source)
		await expect(page.getByRole('button', { name: 'Save article', exact: true })).toBeVisible()
		const captureId = new URL(page.url()).hash.slice(1)
		const closed = page.waitForEvent('close')
		await page.getByRole('button', { name: 'Close', exact: true }).click()
		await closed
		const present = await context
			.serviceWorkers()[0]!
			.evaluate(
				async (id) =>
					Object.hasOwn(
						await chrome.storage.local.get<Record<string, unknown>>(`clipper.capture.${id}`),
						`clipper.capture.${id}`
					),
				captureId
			)
		expect(present).toBe(false)
		expect(source.url()).toBe('http://127.0.0.1:5230/dismiss')
	} finally {
		await context.close()
	}
})

test('packages one local WASM binary and requests only gesture-scoped capture permissions', async () => {
	const { readFile, readdir } = await import('node:fs/promises')
	const manifest = JSON.parse(await readFile('apps/extension/dist/manifest.json', 'utf8'))
	expect(manifest.permissions).toEqual(['activeTab', 'scripting', 'storage'])
	expect(manifest.host_permissions).toBeUndefined()
	expect(manifest.content_scripts).toBeUndefined()
	expect(manifest.externally_connectable).toBeUndefined()
	expect(manifest.web_accessible_resources).toBeUndefined()
	expect(manifest.background).toEqual({ service_worker: 'background.js', type: 'module' })
	expect(manifest.content_security_policy.extension_pages).toContain(
		"script-src 'self' 'wasm-unsafe-eval'"
	)
	expect(manifest.content_security_policy.extension_pages).not.toContain("'unsafe-eval'")
	expect(manifest.content_security_policy.extension_pages).not.toContain('blob:')
	expect(
		(await readdir('apps/extension/dist/assets')).filter((name) => name.endsWith('.wasm'))
	).toHaveLength(1)
})
