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

test('creates, reloads and restores the same account into an independent browser context', async ({
	page,
	browser
}) => {
	await page.goto('/')
	await page.getByRole('button', { name: 'Create account', exact: true }).click()
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
	} finally {
		await second.close()
	}
})

test('invalid restoration does not create an account', async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Recovery phrase', { exact: true }).fill('not a valid recovery phrase')
	await page.getByRole('button', { name: 'Restore account', exact: true }).click()
	await expect(
		page.getByText('That recovery phrase is invalid. Check it and try again.', { exact: true })
	).toBeVisible()
	await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeVisible()
	await expect(page.getByLabel('Recovery phrase', { exact: true })).toHaveValue('')
})

test('retains the account and library after closing every page and browser process with the authority offline', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'clipper-cold-profile-'))
	let context = await chromium.launchPersistentContext(profile, { headless: true })
	try {
		const page = await context.newPage()
		await page.goto('http://127.0.0.1:5180')
		await page.getByRole('button', { name: 'Create account', exact: true }).click()
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
		await page.getByRole('button', { name: 'Create account', exact: true }).click()
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
	await page.getByRole('button', { name: 'Create account', exact: true }).click()
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
async function fixtureArticle(page: import('@playwright/test').Page) {
	let extractions = 0
	await page.route('**/api/capture/*', async (route) => {
		const input: { operationId: string; url: string } = route.request().postDataJSON()
		const common = {
			operationId: input.operationId,
			finalUrl: 'https://example.com/saved?order=1&keep=2'
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
						html: '<h3>Structured heading</h3><p>Exact UI text café 🦊</p><p>Literal &lt;script&gt; stays text. <a href="#fn1">Citation</a></p><ol><li id="fn1">Saved footnote</li></ol><pre><code>const safe = true</code></pre><a href="https://external.example/next">External source</a><img src="https://images.example/pixel.png"><script>globalThis.readerCompromised=true</script><p onclick="globalThis.readerCompromised=true">Safe text</p>',
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

test('Add Link previews, saves and detects a resolved duplicate without replacing content', async ({
	page
}) => {
	const extractions = await fixtureArticle(page)
	const remoteRequests: string[] = []
	page.on('request', (request) => {
		if (request.url().includes('images.example')) remoteRequests.push(request.url())
	})
	await page.goto('/')
	await page.getByRole('button', { name: 'Create account', exact: true }).click()
	await expect(page.getByRole('heading', { name: 'Add link', exact: true })).toBeVisible()
	await page.getByLabel('Article URL', { exact: true }).fill('https://short.example/#intro')
	await page.getByRole('button', { name: 'Get article', exact: true }).click()
	await expect(page.getByRole('region', { name: 'Article preview' })).toContainText(
		'Exact UI text café 🦊'
	)
	await page.getByRole('button', { name: 'Save article', exact: true }).click()
	await expect(page.getByText('Article synced.', { exact: true }).first()).toBeVisible()
	await page.getByRole('button', { name: 'Open saved article', exact: true }).click()
	await expect(page.getByRole('article')).toContainText('Literal <script> stays text.')
	const reader = page.getByRole('article')
	await expect(reader.getByRole('heading', { name: 'Structured heading' })).toBeVisible()
	await expect(reader.locator('code')).toHaveText('const safe = true')
	await expect(reader.locator('script,img,[onclick]')).toHaveCount(0)
	const external = reader.getByRole('link', { name: 'External source' })
	await expect(external).toHaveAttribute('href', 'https://external.example/next')
	await expect(external).not.toHaveAttribute('target')
	await reader.getByRole('link', { name: 'Citation', exact: true }).click()
	await expect(reader.locator('li')).toBeFocused()
	expect(await page.evaluate(() => Reflect.get(globalThis, 'readerCompromised'))).toBeUndefined()

	await page
		.getByLabel('Article URL', { exact: true })
		.fill('https://example.com/saved?order=1&keep=2#different')
	await page.getByRole('button', { name: 'Get article', exact: true }).click()
	await expect(page.getByText('Already saved.', { exact: true })).toBeVisible()
	expect(remoteRequests).toEqual([])
	expect(extractions()).toBe(1)
	await expect(
		page
			.getByRole('region', { name: 'Saved articles' })
			.getByRole('button', { name: 'UI saved article', exact: true })
	).toHaveCount(1)
	await page.route('https://external.example/next', (route) =>
		route.fulfill({ contentType: 'text/html', body: '<p>External destination</p>' })
	)
	const pagesBefore = page.context().pages().length
	await external.click()
	await expect(page).toHaveURL('https://external.example/next')
	expect(page.context().pages()).toHaveLength(pagesBefore)
	await page.goBack()
	await page.getByRole('button', { name: 'Sign out', exact: true }).click()
	await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeVisible()
	await expect(page.getByText('UI saved article', { exact: true })).toHaveCount(0)
	await expect(page.getByRole('article')).toHaveCount(0)
})

test('UI preview saves offline, survives a full browser restart and syncs to a restored profile', async ({
	browser
}) => {
	const profile = await mkdtemp(join(tmpdir(), 'clipper-ui-profile-'))
	let context = await chromium.launchPersistentContext(profile, { headless: true })
	const independent = await browser.newContext()
	try {
		const page = await context.newPage()
		await fixtureArticle(page)
		await page.goto('http://127.0.0.1:5180')
		await page.getByRole('button', { name: 'Create account', exact: true }).click()
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
		await page
			.getByLabel('Article URL', { exact: true })
			.fill('https://example.com/saved?order=1&keep=2')
		await page.getByRole('button', { name: 'Get article', exact: true }).click()
		await expect(page.getByRole('button', { name: 'Save article', exact: true })).toBeVisible()
		await authority.stop()
		await page.getByRole('button', { name: 'Save article', exact: true }).click()
		await expect(
			page.getByText('Article saved on this device. Sync pending.', { exact: true })
		).toBeVisible()
		await context.close()
		context = await chromium.launchPersistentContext(profile, { headless: true })
		const reopened = await context.newPage()
		await reopened.goto('http://127.0.0.1:5180')
		await reopened
			.getByRole('region', { name: 'Saved articles' })
			.getByRole('button', { name: 'UI saved article', exact: true })
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
			.getByRole('button', { name: 'UI saved article', exact: true })
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

test('canceling an Add Link request prevents a late preview and leaves the form usable', async ({
	page
}) => {
	let release!: () => void
	const pending = new Promise<void>((resolve) => {
		release = resolve
	})
	await page.route('**/api/capture/resolve', async (route) => {
		await pending
		await route.fulfill({ status: 503, json: { code: 'gatewayUnavailable' } }).catch(() => {})
	})
	await page.goto('/')
	await page.getByRole('button', { name: 'Create account', exact: true }).click()
	await page.getByLabel('Article URL', { exact: true }).fill('https://example.com/')
	await page.getByRole('button', { name: 'Get article', exact: true }).click()
	await expect(
		page.getByText('Resolving and extracting the article…', { exact: true })
	).toBeVisible()
	await page.getByRole('button', { name: 'Cancel', exact: true }).click()
	release()
	await expect(page.getByLabel('Article URL', { exact: true })).toBeEnabled()
	await expect(page.getByRole('button', { name: 'Save article', exact: true })).toHaveCount(0)
})

test('reader falls back to exact text when a saved asset is not HTML', async ({ page }) => {
	await page.goto('/')
	await page.getByRole('button', { name: 'Create account', exact: true }).click()
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const result = await page.evaluate(async () => {
		const path = '/tests/storage-driver.ts'
		const { save } = await import(/* @vite-ignore */ path)
		return save(crypto.randomUUID())
	})
	expect(result).toBe('saved')
	await page
		.getByRole('region', { name: 'Saved articles' })
		.getByRole('button', { name: 'Restart proof', exact: true })
		.click()
	await expect(page.getByRole('article')).toContainText('Exact offline text café 🦊')
	await expect(page.getByRole('article').locator('.reader')).toHaveClass(/plain/)
	await page.getByRole('button', { name: 'Close article', exact: true }).click()
	await expect(page.getByRole('article')).toHaveCount(0)
})
