import { openAddLink } from './add-link.js'
import { test, expect, chromium } from '@playwright/test'
import { startLocalJazzServer } from 'jazz-tools/testing'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { app } from '../src/lib/backend/jazz/schema.js'
import permissions from '../src/lib/backend/jazz/permissions.js'

let authority: Awaited<ReturnType<typeof startLocalJazzServer>>
let dataDir: string
const startAuthority = () =>
	startLocalJazzServer({
		appId: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
		host: '127.0.0.1',
		port: 5181,
		dataDir,
		schema: app,
		permissions
	})
test.beforeAll(async () => {
	dataDir = await mkdtemp(join(tmpdir(), 'clipper-browser-'))
	authority = await startAuthority()
})
test.afterAll(async () => {
	await authority?.stop()
	if (dataDir) await rm(dataDir, { recursive: true, force: true })
})

test('starts locally without signup, reloads and restores the same account into an independent browser context', async ({
	page,
	browser
}) => {
	let devServerReloads = 0
	page.on('websocket', (socket) => {
		socket.on('framereceived', ({ payload }) => {
			if (typeof payload === 'string' && payload.includes('"type":"full-reload"'))
				devServerReloads++
		})
	})
	await page.goto('/')
	// Cold module/WASM startup must reach the usable local library before the
	// separate remote-acceptance assertion starts its timeout.
	await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible({
		timeout: 30000
	})
	await expect(page.getByRole('button', { name: 'Create account', exact: true })).toHaveCount(0)
	await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0)
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	await page.reload()
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	const phrase = await dialog.getByLabel('Recovery phrase', { exact: true }).inputValue()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	const second = await browser.newContext()
	try {
		const restored = await second.newPage()
		await restored.goto('http://127.0.0.1:5180')
		await restored.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await restored.getByRole('button', { name: 'Restore account', exact: true }).click()
		await expect(restored.getByText('Private library synced.', { exact: true })).toBeVisible()
		await restored.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
		const recoveredPhrase = await restored
			.getByRole('dialog')
			.getByLabel('Recovery phrase', { exact: true })
			.inputValue()
		await restored.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
		// Assert a boolean after closing the dialog so failures cannot print credentials.
		expect(recoveredPhrase === phrase).toBe(true)
		// Stop the real authority: the SDK transport can live in a SharedWorker.
		await authority.stop()
		await restored.reload()
		await expect(
			restored.getByText('Library saved on this device. Sync pending.', { exact: true })
		).toBeVisible()
		authority = await startAuthority()
		await restored.reload()
		await expect(restored.getByText('Private library synced.', { exact: true })).toBeVisible()
		expect(devServerReloads, 'Account navigation must not race a Vite full-page reload').toBe(0)
	} finally {
		await second.close()
	}
})

test('invalid restoration preserves the current local library', async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Recovery phrase', { exact: true }).fill('not a valid recovery phrase')
	await page.getByRole('button', { name: 'Restore account', exact: true }).click()
	await expect(
		page.getByText('That recovery phrase is invalid. Check it and try again.', { exact: true })
	).toBeVisible()
	await expect(page.getByRole('region', { name: 'Saved articles' })).toBeVisible()
	await expect(page.getByLabel('Recovery phrase', { exact: true })).toHaveValue('')
})

test('retains the account and library after closing every page and browser process with the authority offline', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'clipper-cold-profile-'))
	let context = await chromium.launchPersistentContext(profile, { headless: true })
	try {
		const page = await context.newPage()
		await page.goto('http://127.0.0.1:5180')
		await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
		await authority.stop()
		await context.close()
		// Persistent-context close exits its browser process, including its workers.
		context = await chromium.launchPersistentContext(profile, { headless: true })
		const reopened = await context.newPage()
		await reopened.goto('http://127.0.0.1:5180')
		await expect(
			reopened.getByText('Library saved on this device. Sync pending.', { exact: true })
		).toBeVisible()
		authority = await startAuthority()
		await reopened.reload()
		await expect(reopened.getByText('Private library synced.', { exact: true })).toBeVisible()
	} finally {
		await context.close()
		await rm(profile, { recursive: true, force: true })
	}
})

test('saves new content offline, restarts the browser, and syncs to a restored profile', async ({
	browser
}) => {
	const profile = await mkdtemp(join(tmpdir(), 'clipper-content-profile-'))
	let context = await chromium.launchPersistentContext(profile, { headless: true })
	const independent = await browser.newContext()
	const operationId = crypto.randomUUID()
	const expected = {
		text: 'Exact offline text café 🦊',
		byteLength: 600 * 1024,
		bytesHash: createHash('sha256')
			.update(Uint8Array.from({ length: 600 * 1024 }, (_, index) => index % 256))
			.digest('hex')
	}
	try {
		const page = await context.newPage()
		await page.goto('http://127.0.0.1:5180')
		await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
		await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
		const phrase = await page
			.getByRole('dialog')
			.getByLabel('Recovery phrase', { exact: true })
			.inputValue()
		await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
		const restored = await independent.newPage()
		await restored.goto('http://127.0.0.1:5180')
		await restored.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await restored.getByRole('button', { name: 'Restore account', exact: true }).click()
		await expect(restored.getByText('Private library synced.', { exact: true })).toBeVisible()
		await authority.stop()
		expect(
			await page.evaluate(async (id) => {
				const path = '/tests/storage-driver.ts'
				return (await import(/* @vite-ignore */ path)).save(id)
			}, operationId)
		).toBe('saved')
		await context.close()
		context = await chromium.launchPersistentContext(profile, { headless: true })
		const reopened = await context.newPage()
		await reopened.goto('http://127.0.0.1:5180')
		await expect(
			reopened.getByText('Library saved on this device. Sync pending.', { exact: true })
		).toBeVisible()
		expect(
			await reopened.evaluate(async (id) => {
				const path = '/tests/storage-driver.ts'
				return (await import(/* @vite-ignore */ path)).read(id)
			}, operationId)
		).toEqual(expected)
		authority = await startAuthority()
		await reopened.reload()
		await restored.reload()
		await expect(restored.getByText('Private library synced.', { exact: true })).toBeVisible()
		await expect
			.poll(
				() =>
					restored.evaluate(async (id) => {
						const path = '/tests/storage-driver.ts'
						return (await import(/* @vite-ignore */ path)).read(id)
					}, operationId),
				{ timeout: 30000 }
			)
			.toEqual(expected)
	} finally {
		await independent.close()
		await context.close()
		await rm(profile, { recursive: true, force: true })
	}
})

test('authenticates capture requests with the existing account and rejects missing or forged bearers', async ({
	page,
	request
}) => {
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const missing = await request.post('/api/capture/resolve')
	expect(missing.status()).toBe(401)
	expect(await missing.json()).toEqual({ code: 'sessionUnavailable', retryable: false })
	expect(
		(
			await request.post('/api/capture/resolve', { headers: { Authorization: 'Bearer forged' } })
		).status()
	).toBe(401)
	// Passing authentication reaches destination validation; loopback is blocked
	// before any upstream connection. Missing or forged bearers remain 401.
	expect(
		await page.evaluate(async () => {
			const path = '/tests/storage-driver.ts'
			const { requestCapture } = await import(/* @vite-ignore */ path)
			return (
				await requestCapture('resolve', {
					protocolVersion: 1,
					operationId: crypto.randomUUID(),
					url: 'http://127.0.0.1/'
				})
			).status
		})
	).toBe(400)
	await authority.stop()
	try {
		const outage = await page.evaluate(async () => {
			const path = '/tests/storage-driver.ts'
			const { requestCapture } = await import(/* @vite-ignore */ path)
			const response = await requestCapture('resolve', {
				protocolVersion: 1,
				operationId: crypto.randomUUID(),
				url: 'http://127.0.0.1/'
			})
			return { status: response.status, body: await response.json() }
		})
		expect(outage).toEqual({ status: 503, body: { code: 'gatewayUnavailable', retryable: true } })
	} finally {
		authority = await startAuthority()
	}
})

/** Fixture gateway responses; native persistence, browser processes and Jazz sync stay real. */
async function fixtureArticle(
	page: import('@playwright/test').Page,
	beforeExtract?: () => Promise<void>,
	finalUrl = 'https://example.com/saved?order=1&keep=2'
) {
	let extractions = 0
	await page.route('**/api/capture/*', async (route) => {
		const input: { operationId: string; url: string } = route.request().postDataJSON()
		const common = {
			operationId: input.operationId,
			finalUrl
		}
		if (route.request().url().endsWith('/resolve'))
			await route.fulfill({
				json: {
					...common,
					submittedUrl: input.url,
					redirects: [],
					resolvedAt: new Date().toISOString()
				}
			})
		else {
			extractions++
			await beforeExtract?.()
			await route.fulfill({
				json: {
					...common,
					provenance: {
						submittedUrl: input.url,
						redirects: [],
						resolvedAt: new Date().toISOString()
					},
					canonicalCandidate: 'https://unrelated.example/',
					candidate: {
						title: 'UI saved article',
						text: 'Exact UI text café 🦊\nLiteral <script> stays text.',
						html: '<h3>Structured heading</h3><details><summary>Diagram details</summary><svg viewBox="0 0 100 100" width="100" height="100" onload="globalThis.readerCompromised=true"><title>Saved diagram</title><path d="M0 0 L100 100" stroke="red"/><circle r="10" fill="url(https://images.example/paint)"/><image href="https://images.example/svg-image"/><foreignObject><p>Embedded</p></foreignObject><animate attributeName="href" values="javascript:alert(1)"/></svg></details><p>Exact UI text café 🦊</p><p>Literal &lt;script&gt; stays text. <a href="#fn1">Citation</a></p><ol><li id="fn1">Saved footnote</li></ol><pre><code>const safe = true</code></pre><a href="https://external.example/next">External source</a><img src="https://images.example/pixel.png"><script>globalThis.readerCompromised=true</script><p onclick="globalThis.readerCompromised=true">Safe text</p>',
						assetCandidates: [
							{ sourceUrl: 'https://images.example/pixel.png', alt: 'Unavailable image' }
						],
						partialEvidence: ['assetsNotFetched'],
						parserVersion: 'fixture',
						normalizationVersion: '1'
					}
				}
			})
		}
	})
	return () => extractions
}

test('Add Link automatically saves and detects a resolved duplicate without replacing content', async ({
	page
}) => {
	const actionWarnings: string[] = []
	page.on('console', (message) => {
		if (message.type() === 'warning' && message.text().includes('Custom actions should not call'))
			actionWarnings.push(message.text())
	})
	const extractions = await fixtureArticle(page)
	const remoteRequests: string[] = []
	page.on('request', (request) => {
		if (request.url().includes('images.example')) remoteRequests.push(request.url())
	})
	await page.goto('/')
	await openAddLink(page)
	await page.getByLabel('Article URL', { exact: true }).fill('https://short.example/#intro')
	await page
		.getByRole('dialog', { name: 'Add link', exact: true })
		.getByRole('button', { name: 'Add link', exact: true })
		.click()
	await expect(page.getByRole('button', { name: 'Save article', exact: true })).toHaveCount(0)
	await expect(page.getByRole('region', { name: 'Article preview' })).toHaveCount(0)
	await expect(page.getByRole('article')).toHaveCount(0)
	await expect(page.getByRole('link', { name: 'UI saved article', exact: true })).toBeVisible()
	await expect(page.getByText('Article synced.', { exact: true })).toHaveCount(0)
	await expect(page.getByRole('link', { name: 'Open saved article', exact: true })).toHaveCount(0)
	await page.getByRole('link', { name: 'UI saved article', exact: true }).click()
	await expect(page.getByRole('article')).toContainText('Literal <script> stays text.')
	const reader = page.getByRole('article')
	await expect(page.getByRole('link', { name: 'Open original', exact: true })).toBeVisible()
	await expect(reader.getByRole('heading', { name: 'Structured heading' })).toBeVisible()
	await expect(reader.locator('code')).toHaveText('const safe = true')
	await expect(reader.locator('svg')).toBeHidden()
	await reader.locator('summary').focus()
	await page.keyboard.press('Enter')
	await expect(reader.locator('details')).toHaveAttribute('open', '')
	await expect(reader.locator('svg')).toBeVisible()
	await expect(reader.locator('path')).toHaveAttribute('stroke', 'red')
	expect(await reader.locator('svg').evaluate((node) => node.getBoundingClientRect().width)).toBe(
		100
	)
	await expect(reader.locator('image,foreignObject,animate,[onload],circle[fill]')).toHaveCount(0)
	await expect(reader.locator('script,img,[onclick]')).toHaveCount(0)
	const external = reader.getByRole('link', { name: 'External source' })
	await expect(external).toHaveAttribute('href', 'https://external.example/next')
	await expect(external).not.toHaveAttribute('target')
	await reader.getByRole('link', { name: 'Citation', exact: true }).click()
	await page.getByRole('note').getByRole('link', { name: 'Open note', exact: true }).click()
	await expect(reader.locator('li')).toBeFocused()
	await expect(page).toHaveURL(/\/articles\/[0-9a-f-]+/)
	await expect(page.getByRole('region', { name: 'Saved articles' })).toHaveCount(0)
	await page.getByRole('link', { name: 'Open library', exact: true }).click()
	expect(await page.evaluate(() => Reflect.get(globalThis, 'readerCompromised'))).toBeUndefined()

	await openAddLink(page)
	await page
		.getByLabel('Article URL', { exact: true })
		.fill('https://example.com/saved?order=1&keep=2#different')
	await page
		.getByRole('dialog', { name: 'Add link', exact: true })
		.getByRole('button', { name: 'Add link', exact: true })
		.click()
	await expect(page.getByText('Already saved.', { exact: true })).toBeVisible()
	expect(remoteRequests).toEqual([])
	expect(extractions()).toBe(1)
	await expect(
		page
			.getByRole('region', { name: 'Saved articles' })
			.getByRole('link', { name: 'UI saved article', exact: true })
	).toHaveCount(1)
	await page
		.getByRole('region', { name: 'Saved articles' })
		.getByRole('link', { name: 'UI saved article', exact: true })
		.click()
	await page.route('https://external.example/next', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<p>External destination</p>' })
	)
	const pagesBefore = page.context().pages().length
	await external.click()
	await expect(page).toHaveURL('https://external.example/next')
	expect(page.context().pages()).toHaveLength(pagesBefore)
	await page.goBack()
	await expect(page.getByRole('article')).toContainText('Exact UI text café 🦊')
	await page.getByRole('link', { name: 'Open library', exact: true }).click()
	await expect(page.getByRole('region', { name: 'Saved articles' })).toBeVisible()
	await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0)
	await expect(page.getByRole('article')).toHaveCount(0)
	expect(actionWarnings).toEqual([])
})

test('UI Add Link saves automatically with the authority offline, survives a full browser restart and syncs to a restored profile', async ({
	browser
}) => {
	const profile = await mkdtemp(join(tmpdir(), 'clipper-ui-profile-'))
	let context = await chromium.launchPersistentContext(profile, { headless: true })
	const independent = await browser.newContext()
	try {
		const page = await context.newPage()
		await fixtureArticle(page, () => authority.stop())
		await page.goto('http://127.0.0.1:5180')
		await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
		await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
		const phrase = await page
			.getByRole('dialog')
			.getByLabel('Recovery phrase', { exact: true })
			.inputValue()
		await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
		const restored = await independent.newPage()
		await restored.goto('http://127.0.0.1:5180')
		await restored.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await restored.getByRole('button', { name: 'Restore account', exact: true }).click()
		await expect(restored.getByText('Private library synced.', { exact: true })).toBeVisible()
		await openAddLink(page)
		await page
			.getByLabel('Article URL', { exact: true })
			.fill('https://example.com/saved?order=1&keep=2')
		await page
			.getByRole('dialog', { name: 'Add link', exact: true })
			.getByRole('button', { name: 'Add link', exact: true })
			.click()

		await expect(
			page
				.getByRole('region', { name: 'Saved articles' })
				.getByRole('link', { name: 'UI saved article', exact: true })
		).toBeVisible()
		await page.getByRole('link', { name: 'UI saved article', exact: true }).click()
		await expect(page.getByRole('article')).toContainText('Exact UI text café 🦊')
		await context.close()
		context = await chromium.launchPersistentContext(profile, { headless: true })
		const reopened = await context.newPage()
		await reopened.goto('http://127.0.0.1:5180')
		await reopened
			.getByRole('region', { name: 'Saved articles' })
			.getByRole('link', { name: 'UI saved article', exact: true })
			.click()
		await expect(reopened.getByRole('article')).toContainText('Exact UI text café 🦊')
		await expect(reopened.getByRole('article')).toContainText('Literal <script> stays text.')
		await expect(
			reopened.getByRole('article').getByRole('heading', { name: 'Structured heading' })
		).toBeVisible()
		await expect(reopened.getByRole('article').locator('code')).toHaveText('const safe = true')

		authority = await startAuthority()
		await reopened.reload()
		await restored.reload()
		await restored
			.getByRole('region', { name: 'Saved articles' })
			.getByRole('link', { name: 'UI saved article', exact: true })
			.click({ timeout: 30000 })
		await expect(restored.getByRole('article')).toContainText('Exact UI text café 🦊')
		await expect(
			restored.getByRole('article').getByRole('heading', { name: 'Structured heading' })
		).toBeVisible()
	} finally {
		await independent.close()
		await context.close()
		await rm(profile, { recursive: true, force: true })
	}
})

test('background extraction stays quiet and leaves the saved URL and form usable', async ({
	page
}) => {
	const entered = Promise.withResolvers<void>()
	let release!: () => void
	const pending = new Promise<void>((resolve) => {
		release = resolve
	})
	await page.route('**/api/capture/resolve', async (route) => {
		entered.resolve()
		await pending
		await route.fulfill({ status: 503, json: { code: 'gatewayUnavailable' } }).catch(() => {})
	})
	await page.goto('/')
	await openAddLink(page)
	await page.getByLabel('Article URL', { exact: true }).fill('https://example.com/')
	await page
		.getByRole('dialog', { name: 'Add link', exact: true })
		.getByRole('button', { name: 'Add link', exact: true })
		.click()
	await entered.promise
	await expect(page.locator('[data-article-id]')).toContainText('https://example.com/')
	await expect(page.getByRole('link', { name: 'Open original', exact: true })).toHaveCount(0)
	await expect(
		page.getByText('Resolving and extracting the article…', { exact: true })
	).toHaveCount(0)
	await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toHaveCount(0)
	await expect(page.getByRole('link', { name: 'Open saved article', exact: true })).toHaveCount(0)
	release()
	await expect(page.getByRole('button', { name: 'Add link', exact: true })).toBeEnabled()
	await expect(page.getByRole('button', { name: 'Save article', exact: true })).toHaveCount(0)
})

test('reader falls back to exact text when a saved asset is not HTML', async ({ page }) => {
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const result = await page.evaluate(async () => {
		const path = '/tests/storage-driver.ts'
		const { save } = await import(/* @vite-ignore */ path)
		return save(crypto.randomUUID())
	})
	expect(result).toBe('saved')
	await page
		.getByRole('region', { name: 'Saved articles' })
		.getByRole('link', { name: 'Restart proof', exact: true })
		.click()
	await expect(page.getByRole('article')).toContainText('Exact offline text café 🦊')
	await expect(page.getByRole('article').locator('.reader')).toHaveClass(/plain/)
	await page.getByRole('link', { name: 'Open library', exact: true }).click()
	await expect(page.getByRole('article')).toHaveCount(0)
})

test('first use opens a stable local library with the authority unavailable and no signup', async ({
	page
}) => {
	await authority.stop()
	try {
		await page.goto('/')
		await expect(page.getByRole('region', { name: 'Saved articles' })).toBeVisible()
		await expect(
			page.getByText('Library saved on this device. Sync pending.', { exact: true })
		).toBeVisible()
		await expect(page.getByRole('button', { name: 'Create account', exact: true })).toHaveCount(0)
		await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toHaveCount(0)
		await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
		const phrase = await page
			.getByRole('dialog')
			.getByLabel('Recovery phrase', { exact: true })
			.inputValue()
		await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
		await page.reload()
		await expect(page.getByRole('region', { name: 'Saved articles' })).toBeVisible()
		await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
		const reopenedPhrase = await page
			.getByRole('dialog')
			.getByLabel('Recovery phrase', { exact: true })
			.inputValue()
		await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
		expect(phrase.length > 0 && phrase === reopenedPhrase).toBe(true)
	} finally {
		authority = await startAuthority()
	}
})

test('reader links support new tabs, direct reload and owner-scoped missing content', async ({
	page,
	browser
}) => {
	await fixtureArticle(page)
	await page.goto('/')
	await openAddLink(page)
	await page.getByLabel('Article URL', { exact: true }).fill('https://example.com/saved')
	await page
		.getByRole('dialog', { name: 'Add link', exact: true })
		.getByRole('button', { name: 'Add link', exact: true })
		.click()
	await expect(page.getByRole('link', { name: 'UI saved article', exact: true })).toBeVisible()
	const link = page
		.getByRole('region', { name: 'Saved articles' })
		.getByRole('link', { name: 'UI saved article', exact: true })
	const href = await link.getAttribute('href')
	expect(href).toMatch(/^\/articles\/[0-9a-f-]+$/)
	const [tab] = await Promise.all([
		page.context().waitForEvent('page'),
		link.click({ modifiers: ['ControlOrMeta'] })
	])
	try {
		await expect(tab.getByRole('article')).toContainText('Exact UI text café 🦊')
		await expect(tab.getByRole('region', { name: 'Saved articles' })).toHaveCount(0)
		await expect(page).toHaveURL('http://127.0.0.1:5180/')
		await tab.reload()
		await expect(tab).toHaveURL(new RegExp(href! + '$'))
		await expect(tab.getByRole('article')).toContainText('Exact UI text café 🦊')
		const stranger = await browser.newContext()
		try {
			const denied = await stranger.newPage()
			await denied.goto('http://127.0.0.1:5180' + href)
			await expect(
				denied.getByText(
					'This article is not available on this device. Reconnect and open it again.',
					{ exact: true }
				)
			).toBeVisible()
			await expect(denied.getByRole('article')).toHaveCount(0)
		} finally {
			await stranger.close()
		}
	} finally {
		await tab.close()
	}
})

test('capture continues when the initiating library page is replaced by a reader route', async ({
	page
}) => {
	await fixtureArticle(page)
	await page.goto('/')
	await openAddLink(page)
	await page.getByLabel('Article URL', { exact: true }).fill('https://example.com/first')
	await page
		.getByRole('dialog', { name: 'Add link', exact: true })
		.getByRole('button', { name: 'Add link', exact: true })
		.click()
	await expect(page.getByRole('link', { name: 'UI saved article', exact: true })).toBeVisible()
	const first = page
		.getByRole('region', { name: 'Saved articles' })
		.getByRole('link', { name: 'UI saved article', exact: true })
	const gate = Promise.withResolvers<void>(),
		entered = Promise.withResolvers<void>()
	await page.unroute('**/api/capture/*')
	const extractions = await fixtureArticle(
		page,
		async () => {
			entered.resolve()
			await gate.promise
		},
		'https://example.com/second'
	)
	await openAddLink(page)
	await page.getByLabel('Article URL', { exact: true }).fill('https://example.com/second')
	await page
		.getByRole('dialog', { name: 'Add link', exact: true })
		.getByRole('button', { name: 'Add link', exact: true })
		.click()
	await entered.promise
	await first.click()
	await expect(page.getByRole('article')).toContainText('Exact UI text café 🦊')
	gate.resolve()
	await page.getByRole('link', { name: 'Open library', exact: true }).click()
	await expect(
		page
			.getByRole('region', { name: 'Saved articles' })
			.getByRole('link', { name: 'UI saved article', exact: true })
	).toHaveCount(2)
	expect(extractions()).toBe(1)
})

test('Add Link persists article objects before a worker processes their content serially', async ({
	page,
	context
}) => {
	const gate = Promise.withResolvers<void>()
	let active = 0,
		max = 0,
		count = 0
	await page.route('**/api/capture/*', async (route) => {
		const input: { operationId: string; url: string } = route.request().postDataJSON()
		const base = { operationId: input.operationId, finalUrl: input.url }
		if (route.request().url().endsWith('/resolve')) {
			await route.fulfill({ json: base })
			return
		}
		active++
		max = Math.max(max, active)
		count++
		try {
			if (count === 1) await gate.promise
			await route.fulfill({
				json: {
					...base,
					candidate: {
						title: input.url.endsWith('/one') ? 'Queued one' : 'Queued two',
						text: 'Queued content',
						html: '<p>Queued content</p>'
					}
				}
			})
		} finally {
			active--
		}
	})
	const started = page.waitForEvent('worker', {
		predicate: (w) => w.url().includes('article-worker.ts')
	})
	await page.goto('/')
	const worker = await started
	expect(await worker.evaluate(() => typeof document)).toBe('undefined')
	const urls = ['https://example.com/one', 'https://example.com/two']
	await openAddLink(page)
	await page.getByLabel('Article URL', { exact: true }).fill(urls[0] ?? '')
	await page
		.getByRole('dialog', { name: 'Add link', exact: true })
		.getByRole('button', { name: 'Add link', exact: true })
		.click()
	await expect.poll(() => count).toBe(1)
	await expect(page.getByRole('button', { name: 'Add link', exact: true })).toBeEnabled()
	const other = await context.newPage()
	await other.goto('/')
	await expect(other.getByRole('button', { name: 'Add link', exact: true })).toBeEnabled()
	await openAddLink(other)
	await other.getByLabel('Article URL', { exact: true }).fill(urls[1] ?? '')
	await other
		.getByRole('dialog', { name: 'Add link', exact: true })
		.getByRole('button', { name: 'Add link', exact: true })
		.click()
	await expect(other.getByRole('button', { name: 'Add link', exact: true })).toBeEnabled()
	await expect(page.locator('[data-article-id]')).toHaveCount(2)
	await expect(page.getByRole('link', { name: 'Open original', exact: true })).toHaveCount(0)
	const rows = await page.evaluate(async (urls) => {
		const path = '/tests/article-driver.ts'
		return (await import(/* @vite-ignore */ path)).inspect(urls)
	}, urls)
	expect(
		rows.map(
			(r: { url: string; contentId: string | null } | null) =>
				r && { url: r.url, contentId: r.contentId }
		)
	).toEqual(urls.map((url) => ({ url, contentId: null })))
	expect(count).toBe(1)
	gate.resolve()
	await expect(page.getByRole('link', { name: 'Queued one', exact: true })).toBeVisible()
	await expect(page.getByRole('link', { name: 'Queued two', exact: true })).toBeVisible()
	expect(max).toBe(1)
	expect(count).toBe(2)
	await other.close()
})

test('the article save operation accepts supplied content without fetching the URL', async ({
	page
}) => {
	const requests: string[] = []
	await page.route('**/api/capture/*', async (route) => {
		requests.push(route.request().url())
		await route.abort()
	})
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const result = await page.evaluate(async () => {
		const path = '/tests/article-driver.ts'
		return (await import(/* @vite-ignore */ path)).supplied('https://example.com/supplied')
	})
	expect(result.ready).toBe(true)
	expect(requests).toEqual([])
	await page.goto('/articles/' + result.id)
	await expect(page.getByRole('article')).toContainText('Content supplied by a browser clip.')
})

test('a worker resumes a URL-only article after complete browser restart', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'clipper-pending-article-'))
	let context = await chromium.launchPersistentContext(profile, { headless: true })
	const entered = Promise.withResolvers<void>(),
		gate = Promise.withResolvers<void>()
	const url = 'https://example.com/resume'
	try {
		const page = await context.newPage()
		await page.route('**/api/capture/*', async (route) => {
			entered.resolve()
			await gate.promise
			await route.abort().catch(() => {})
		})
		await page.goto('http://127.0.0.1:5180')
		await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
		await openAddLink(page)
		await page.getByLabel('Article URL', { exact: true }).fill(url)
		await page
			.getByRole('dialog', { name: 'Add link', exact: true })
			.getByRole('button', { name: 'Add link', exact: true })
			.click()
		await entered.promise
		await expect(page.getByRole('button', { name: 'Add link', exact: true })).toBeEnabled()
		const before = await page.evaluate(async (url) => {
			const path = '/tests/article-driver.ts'
			return (await import(/* @vite-ignore */ path)).inspect([url])
		}, url)
		expect(before[0]?.contentId).toBeNull()
		await context.close()
		gate.resolve()
		context = await chromium.launchPersistentContext(profile, { headless: true })
		const reopened = await context.newPage()
		await fixtureArticle(reopened, undefined, url)
		await reopened.goto('http://127.0.0.1:5180')
		await expect(
			reopened.getByRole('link', { name: 'UI saved article', exact: true })
		).toBeVisible()
		const after = await reopened.evaluate(async (url) => {
			const path = '/tests/article-driver.ts'
			return (await import(/* @vite-ignore */ path)).inspect([url])
		}, url)
		expect(after[0]?.id).toBe(before[0]?.id)
		expect(after[0]?.originalSavedAt).toBe(before[0]?.originalSavedAt)
		expect(after[0]?.contentId).toBeTruthy()
	} finally {
		gate.resolve()
		await context.close()
		await rm(profile, { recursive: true, force: true })
	}
})

test('Retry from a second tab reaches the worker holding the library lock', async ({
	page,
	context
}) => {
	let attempts = 0
	await context.route('**/api/capture/*', async (route) => {
		const input: { operationId: string; url: string } = route.request().postDataJSON()
		const base = { operationId: input.operationId, finalUrl: input.url }
		if (route.request().url().endsWith('/resolve')) {
			await route.fulfill({ json: base })
			return
		}
		attempts++
		if (attempts === 1) {
			await route.fulfill({ status: 503, json: { code: 'gatewayUnavailable' } })
			return
		}
		await route.fulfill({
			json: {
				...base,
				candidate: {
					title: 'Retried across tabs',
					text: 'Saved after retry',
					html: '<p>Saved after retry</p>'
				}
			}
		})
	})
	await page.goto('/')
	await openAddLink(page)
	await page.getByLabel('Article URL', { exact: true }).fill('https://example.com/cross-tab-retry')
	await page
		.getByRole('dialog', { name: 'Add link', exact: true })
		.getByRole('button', { name: 'Add link', exact: true })
		.click()
	await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
	const second = await context.newPage()
	await second.goto('/')
	await expect(second.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
	await second.getByRole('button', { name: 'Retry', exact: true }).click()
	await expect(second.getByRole('link', { name: 'Retried across tabs', exact: true })).toBeVisible()
	await expect(page.getByRole('link', { name: 'Retried across tabs', exact: true })).toBeVisible()
	expect(attempts).toBe(2)
	await second.close()
})

test('keeps account controls in the desktop drawer without replacing the library session', async ({
	page
}) => {
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const drawer = page.locator('aside')
	await expect(drawer.getByRole('button', { name: 'Restore account', exact: true })).toBeVisible()
	await expect(
		page.getByRole('main').getByRole('button', { name: 'Restore account', exact: true })
	).toHaveCount(0)
	await page.locator('header').getByRole('button', { name: 'Close account', exact: true }).click()
	await expect(drawer).toHaveAttribute('aria-hidden', 'true')
	await expect(page.getByRole('region', { name: 'Saved articles' })).toBeVisible()
	await page.locator('header').getByRole('button', { name: 'Show account', exact: true }).click()
	await expect(
		drawer.getByRole('button', { name: 'Show recovery phrase', exact: true })
	).toBeVisible()
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
})

test('mobile drawer hides account controls until opened and restores keyboard focus on Escape', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/')
	await expect(page.getByRole('region', { name: 'Saved articles' })).toBeVisible()
	const drawer = page.locator('aside')
	await expect(drawer).toHaveAttribute('aria-hidden', 'true')
	await page.getByRole('button', { name: 'Show account', exact: true }).click()
	await expect(drawer).toHaveAttribute('aria-hidden', 'false')
	await expect(page.locator('main')).toHaveAttribute('inert', '')
	await drawer.getByLabel('Recovery phrase', { exact: true }).focus()
	await page.keyboard.press('Escape')
	await expect(drawer).toHaveAttribute('aria-hidden', 'true')
	await expect(page.getByRole('button', { name: 'Show account', exact: true })).toBeFocused()
	await expect(page.locator('main')).not.toHaveAttribute('inert', '')
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
		true
	)
})

test('Add link modal focuses its URL field and dismisses without saving', async ({ page }) => {
	await page.goto('/')
	await expect(page.getByRole('region', { name: 'Saved articles' })).toBeVisible()
	const dialog = await openAddLink(page)
	const url = 'https://example.com/modal-dismissal'
	await expect(dialog.getByLabel('Article URL', { exact: true })).toBeFocused()
	await dialog.getByLabel('Article URL', { exact: true }).fill(url)
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(dialog).not.toBeVisible()
	await expect(page.getByRole('button', { name: 'Add link', exact: true })).toBeFocused()
	await openAddLink(page)
	await page.keyboard.press('Escape')
	await expect(dialog).not.toBeVisible()
	await expect(page.getByRole('button', { name: 'Add link', exact: true })).toBeFocused()
	const saved = await page.evaluate(async (url) => {
		const path = '/tests/article-driver.ts'
		return (await import(/* @vite-ignore */ path)).inspect([url])
	}, url)
	expect(saved).toEqual([null])
})

test('global Add link action saves from the reader without replacing or leaving it', async ({
	page
}) => {
	await page.route('**/api/capture/resolve', (route) =>
		route.fulfill({ status: 503, json: { code: 'gatewayUnavailable' } })
	)
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	await page.evaluate(async () => {
		const path = '/tests/article-driver.ts'
		return (await import(/* @vite-ignore */ path)).supplied('https://example.com/modal-reader')
	})
	await page.getByRole('link', { name: 'Supplied clip', exact: true }).click()
	await expect(page.getByRole('article')).toContainText('Content supplied by a browser clip.')
	const dialog = await openAddLink(page)
	const url = 'https://example.com/added-from-reader'
	await dialog.getByLabel('Article URL', { exact: true }).fill(url)
	await dialog.getByRole('button', { name: 'Add link', exact: true }).click()
	await expect(dialog).not.toBeVisible()
	await expect
		.poll(() =>
			page.evaluate(async (url) => {
				const path = '/tests/article-driver.ts'
				return (await import(/* @vite-ignore */ path)).inspect([url])
			}, url)
		)
		.not.toEqual([null])
	await expect(page.getByRole('article')).toContainText('Content supplied by a browser clip.')
})

test('sidebar shows browser connectivity and follows offline and online events', async ({
	page,
	context
}) => {
	await page.goto('/')
	await expect(page.getByText('online', { exact: true })).toBeVisible()
	await expect(
		page.getByText('Offline startup prepared on this browser.', { exact: true })
	).toHaveCount(0)
	await context.setOffline(true)
	await expect(page.getByText('offline', { exact: true })).toBeVisible()
	await expect(page.getByText('online', { exact: true })).toHaveCount(0)
	await context.setOffline(false)
	await expect(page.getByText('online', { exact: true })).toBeVisible()
	await expect(page.getByText('offline', { exact: true })).toHaveCount(0)
})
