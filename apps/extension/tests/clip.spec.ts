import { extensionId, extensionPublicKey } from '../../../tooling/extension-identity.js'
/// <reference types="chrome" />
import { test, expect, chromium } from '@playwright/test'
import { openLibraryFilters } from '../../web/tests/library-popovers.js'
import { readingControls } from '../../web/tests/reader-ui.js'
import type { BrowserContext, Page } from '@playwright/test'
import { startLocalJazzServer } from '../../web/tests/browser-core.js'
import { createServer } from 'node:http'
import { mkdtemp, rm, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { app } from '../../web/src/lib/backend/jazz/schema.js'
import permissions from '../../web/src/lib/backend/jazz/permissions.js'
import { connectionSchema } from '../src/connection.js'
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
async function extension(profile: string, connected = true) {
	const path = resolve('apps/extension/.test-build')
	const context = await chromium.launchPersistentContext(profile, {
		channel: 'chromium',
		headless: true,
		args: [
			`--disable-extensions-except=${path}`,
			`--load-extension=${path}`,
			'--enable-unsafe-extension-debugging'
		]
	})
	context.setDefaultTimeout(15000)
	const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'))
	await expect.poll(() => worker.evaluate(() => chrome.action.onClicked.hasListeners())).toBe(true)
	const id = new URL(worker.url()).host
	expect(id).toBe(extensionId)
	if (
		connected &&
		!(await worker.evaluate(
			async () => !!(await chrome.storage.local.get('clipper.connection'))['clipper.connection']
		))
	) {
		// Connect an independently provisioned web account, as in the user flow.
		const web = await context.newPage()
		let phrase: string
		try {
			await web.goto('http://127.0.0.1:5180/')
			phrase = await readRecovery(web)
		} finally {
			await web.close()
		}
		const options = await openOptions(context, id)
		await options.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await options.getByRole('button', { name: 'Restore account', exact: true }).click()
		try {
			await expect
				.poll(() =>
					worker.evaluate(
						async () =>
							!!(await chrome.storage.local.get('clipper.connection'))['clipper.connection']
					)
				)
				.toBe(true)
		} catch (error) {
			console.info(
				'Extension connection diagnostics',
				JSON.stringify({
					statuses: await options.getByRole('status').allTextContents(),
					alerts: await options.getByRole('alert').allTextContents(),
					storageKeys: await worker.evaluate(async () =>
						Object.keys(await chrome.storage.local.get(null))
					)
				})
			)
			throw error
		}
		await options.close()
	}
	return { context, id, worker }
}
async function invokeToolbar(context: BrowserContext, id: string, source: Page) {
	await source.bringToFront()
	const session = await context.browser()!.newBrowserCDPSession()
	try {
		const { targetInfos } = await session.send('Target.getTargets', {
			filter: [{ type: 'tab', exclude: false }, { exclude: true }]
		})
		const target = targetInfos.find((target) => target.url === source.url())
		if (!target) throw new Error('Missing source tab target')
		await session.send('Extensions.triggerAction', { id, targetId: target.targetId })
	} finally {
		await session.detach()
	}
}
async function clip(context: BrowserContext, id: string, source: Page) {
	const pages = context.pages().length
	await invokeToolbar(context, id, source)
	// Native authorization may wait up to 15 seconds for the cold offscreen owner.
	await expect(source.locator('delightful-clipper-bar')).toBeVisible({ timeout: 20000 })
	expect(context.pages()).toHaveLength(pages)
}

async function openOptions(context: BrowserContext, id: string) {
	const url = `chrome-extension://${id}/index.html`
	const worker = context.serviceWorkers().find((worker) => new URL(worker.url()).host === id)!
	await worker.evaluate(() => chrome.runtime.openOptionsPage())
	await expect.poll(() => context.pages().some((page) => page.url() === url)).toBe(true)
	const page = context.pages().find((page) => page.url() === url)!
	await page.waitForLoadState('domcontentloaded')
	return page
}
async function recovery(context: BrowserContext, id: string) {
	const page = await openOptions(context, id)
	try {
		return await readRecovery(page)
	} finally {
		await page.close()
	}
}
async function readRecovery(page: Page) {
	// Wait for a usable binding; an existing root has no new write receipt.
	await expect(
		page.getByRole('button', { name: 'Show recovery phrase', exact: true })
	).toBeVisible()
	await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
	const dialog = page.getByRole('dialog')
	try {
		await expect(dialog).toBeVisible()
	} catch (error) {
		// Status text and native dialog state only; never log phrase fields or actor context.
		console.info(
			'Extension recovery presentation',
			JSON.stringify({
				statuses: await page.getByRole('status').allTextContents(),
				dialogs: await page
					.locator('dialog')
					.evaluateAll((nodes) => nodes.map((node) => ({ open: node.hasAttribute('open') })))
			})
		)
		throw error
	}
	const phrase = await dialog.getByLabel('Recovery phrase', { exact: true }).inputValue()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
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
		await test.step(
			'capture the rendered bar for review',
			() =>
				source.screenshot({
					path: '/tmp/clipper-extension-bar-review.png',
					clip: { x: 0, y: 0, width: 1100, height: 240 }
				}),
			{ timeout: 10000 }
		)
		const phrase = await test.step(
			'read recovery controls in trusted options',
			() => recovery(context, id),
			{ timeout: 15000 }
		)
		const web = await browser.newContext()
		web.setDefaultTimeout(15000)
		try {
			const reader = await web.newPage()
			let fetches = 0
			reader.on('request', (request) => {
				if (request.url().includes('/api/capture/')) fetches++
			})
			await test.step(
				'restore the extension account in the web replica',
				async () => {
					await reader.goto('/')
					await reader.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
					await reader.getByRole('button', { name: 'Restore account', exact: true }).click()
					await expect(
						reader.getByRole('link', { name: 'Rendered browser article', exact: true })
					).toBeVisible({ timeout: 15000 })
					await reader.getByRole('link', { name: 'Rendered browser article', exact: true }).click()
				},
				{ timeout: 25000 }
			)
			await expect(
				reader.getByText('Only present after JavaScript rendering.', { exact: false })
			).toBeVisible()
			await expect(reader.locator('body')).not.toContainText('DO_NOT_CAPTURE_FORM_SECRET')
			await expect(reader.locator('body')).toContainText('café 🦊')
			await expect(reader.getByRole('link', { name: 'Related article' })).toHaveAttribute(
				'href',
				'http://127.0.0.1:5230/related'
			)
			await test.step(
				'clip the changed source again and preserve the original snapshot',
				async () => {
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

					const readerURL = reader.url()
					await readingControls(reader)
					await reader.getByRole('link', { name: 'Open library', exact: true }).click()
					const row = reader.locator('[data-article-id]')
					await row.getByRole('button', { name: 'Move to Trash', exact: true }).click()
					await expect(row).toHaveCount(0)
					await clip(context, id, source)
					await expect(source.getByRole('status')).toHaveText('Already saved.')
					await expect(
						source.getByRole('link', { name: 'Open article', exact: true })
					).toHaveAttribute('href', readerURL)
					await expect(row).toHaveCount(0)
					await openLibraryFilters(reader)
					await reader.getByRole('radio', { name: 'Trash', exact: true }).check()
					await expect(row).toHaveCount(1)
					await reader.goto(readerURL)
					await reader.getByRole('button', { name: 'Restore article', exact: true }).click()
					await expect(
						reader.getByRole('button', { name: 'Restore article', exact: true })
					).toHaveCount(0)
					await expect(
						reader.getByText('Only present after JavaScript rendering.', { exact: false })
					).toBeVisible()
					expect(fetches).toBe(0)
				},
				{ timeout: 25000 }
			)
		} finally {
			await test.step('close the web replica', () => web.close(), { timeout: 10000 })
		}
	} finally {
		await test.step('close the extension browser', () => context.close(), { timeout: 10000 })
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
		const options = await openOptions(context, id)
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
	const manifest = JSON.parse(await readFile('apps/extension/.test-build/manifest.json', 'utf8'))
	expect(manifest.key).toBe(extensionPublicKey)
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
		(await readdir('apps/extension/.test-build/assets')).filter((name) => name.endsWith('.wasm'))
	).toHaveLength(1)
})

test('restoring an account in options moves subsequent automatic clips to that library', async ({
	browser
}) => {
	const { context, id, worker } = await extension(join(directory, 'restore-profile'))
	const web = await browser.newContext()
	web.setDefaultTimeout(15000)
	let cleanup: PromiseSettledResult<void>[] = []
	try {
		const source = await context.newPage()
		await test.step('save into the original extension account', async () => {
			await source.goto('http://127.0.0.1:5230/before-restore')
			await clip(context, id, source)
			await expect(source.getByRole('status')).toHaveText(saved)
		})
		const previous = connectionSchema.parse(
			await worker.evaluate(
				async () => (await chrome.storage.local.get('clipper.connection'))['clipper.connection']
			)
		)
		const reader = await web.newPage()
		const phrase =
			await test.step('reveal the independent web account recovery phrase', async () => {
				await reader.goto('/')
				await reader.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
				const dialog = reader.getByRole('dialog')
				await expect(dialog).toBeVisible()
				const phrase = await dialog.getByLabel('Recovery phrase', { exact: true }).inputValue()
				await dialog.getByRole('button', { name: 'Close', exact: true }).click()
				return phrase
			})
		await test.step('restore and confirm the new extension connection', async () => {
			const options = await context.newPage()
			await options.goto(`chrome-extension://${id}/index.html`)
			await options.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
			await options.getByRole('button', { name: 'Restore account', exact: true }).click()
			await expect
				.poll(async () => {
					const connection = connectionSchema.safeParse(
						await worker.evaluate(
							async () =>
								(await chrome.storage.local.get('clipper.connection'))['clipper.connection']
						)
					)
					return (
						connection.success &&
						connection.data.confirmationId !== previous.confirmationId &&
						connection.data.accountId !== previous.accountId
					)
				})
				.toBe(true)
		})
		await test.step('save into the restored account and read it in the web replica', async () => {
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
		})
	} finally {
		// A timeout can already have disposed the fixture browser context. Preserve
		// the failed operation instead of replacing it with a protocol cleanup error.
		cleanup = await Promise.allSettled([web.close(), context.close()])
	}
	for (const result of cleanup) if (result.status === 'rejected') throw result.reason
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

test('a signed-out click opens sign-in, rejects invalid input, then saves to the already-open app account', async ({
	browser
}) => {
	const { context, id, worker } = await extension(join(directory, 'fresh-signin-profile'), false)
	const web = await browser.newContext()
	try {
		const reader = await web.newPage()
		let gateway = 0
		reader.on('request', (request) => {
			if (request.url().includes('/api/capture/')) gateway++
		})
		await reader.goto('/')
		await expect(reader.getByRole('button', { name: 'Restore account', exact: true })).toBeVisible()
		await reader.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
		const dialog = reader.getByRole('dialog')
		await expect(dialog).toBeVisible()
		const phrase = await dialog.getByLabel('Recovery phrase', { exact: true }).inputValue()
		await dialog.getByRole('button', { name: 'Close', exact: true }).click()
		const source = await context.newPage()
		await source.goto('http://127.0.0.1:5230/signin')
		const opened = context.waitForEvent('page')
		await invokeToolbar(context, id, source)
		const popup = await opened
		await popup.waitForURL(
			(url) =>
				url.protocol === 'chrome-extension:' && url.host === id && url.pathname === '/signin.html'
		)
		await expect(source.locator('delightful-clipper-bar')).toHaveCount(0)
		expect(
			await worker.evaluate(
				async () =>
					Object.keys(await chrome.storage.local.get(null)).filter((key) =>
						key.startsWith('clipper.capture.')
					).length
			)
		).toBe(0)
		const submit = popup.getByRole('button', { name: /^(Sign in|Restore account)$/ })
		await expect(submit).toBeEnabled()
		await popup.getByLabel('Recovery phrase', { exact: true }).fill('not a valid recovery phrase')
		await submit.click()
		await expect(
			popup.getByText('That recovery phrase is invalid. Check it and try again.', { exact: true })
		).toBeVisible()
		expect(
			await worker.evaluate(
				async () => !!(await chrome.storage.local.get('clipper.connection'))['clipper.connection']
			)
		).toBe(false)
		await expect(source.locator('delightful-clipper-bar')).toHaveCount(0)
		await popup.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		const closed = popup.waitForEvent('close')
		await submit.click()
		await closed
		await expect(source.getByRole('status')).toHaveText(saved)
		await expect(
			reader.getByRole('link', { name: 'Rendered browser article', exact: true })
		).toBeVisible()
		await reader.getByRole('link', { name: 'Rendered browser article', exact: true }).click()
		await expect(
			reader.getByText('Only present after JavaScript rendering.', { exact: false })
		).toBeVisible()
		expect(gateway).toBe(0)
	} finally {
		await web.close()
		await context.close()
	}
})

test('canceling sign-in leaves no article reference and a later click can prompt again', async () => {
	const { context, id, worker } = await extension(join(directory, 'canceled-signin-profile'), false)
	try {
		const source = await context.newPage()
		await source.goto('http://127.0.0.1:5230/canceled-signin')
		const opened = context.waitForEvent('page')
		await invokeToolbar(context, id, source)
		const popup = await opened
		await popup.waitForURL(
			(url) =>
				url.protocol === 'chrome-extension:' && url.host === id && url.pathname === '/signin.html'
		)
		await expect(source.locator('delightful-clipper-bar')).toHaveCount(0)
		await popup.close()
		await expect
			.poll(() =>
				worker.evaluate(
					async () =>
						Object.keys(await chrome.storage.local.get(null)).filter((key) =>
							key.startsWith('clipper.capture.')
						).length
				)
			)
			.toBe(0)
		expect(
			await worker.evaluate(
				async () => !!(await chrome.storage.local.get('clipper.connection'))['clipper.connection']
			)
		).toBe(false)
		const again = context.waitForEvent('page')
		await invokeToolbar(context, id, source)
		const second = await again
		await second.waitForURL(
			(url) =>
				url.protocol === 'chrome-extension:' && url.host === id && url.pathname === '/signin.html'
		)
		await second.close()
	} finally {
		await context.close()
	}
})

test('a stale connection for another account prompts again and cannot save', async () => {
	const { context, id, worker } = await extension(join(directory, 'stale-connection-profile'))
	try {
		await worker.evaluate(async () => {
			const values =
				await chrome.storage.local.get<Record<string, Record<string, unknown>>>(
					'clipper.connection'
				)
			await chrome.storage.local.set({
				'clipper.connection': {
					...values['clipper.connection'],
					accountId: '88888888-8888-4888-8888-888888888888'
				}
			})
		})
		const source = await context.newPage()
		await source.goto('http://127.0.0.1:5230/stale-connection')
		const opened = context.waitForEvent('page')
		await invokeToolbar(context, id, source)
		const popup = await opened
		await popup.waitForURL(
			(url) =>
				url.protocol === 'chrome-extension:' && url.host === id && url.pathname === '/signin.html'
		)
		await expect(source.locator('delightful-clipper-bar')).toHaveCount(0)
		await popup.close()
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
