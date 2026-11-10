import { readRecoveryPhrase, restoreAccount } from './account-ui.js'
import { readingControls } from './reader-ui.js'
import { openAddLink } from './add-link.js'
import type { ArticleImage } from '../src/lib/images/schema.js'
import { test, expect, chromium } from '@playwright/test'
import type { Page } from '@playwright/test'
import { startLocalJazzServer } from './browser-core.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from '../src/lib/backend/jazz/schema.js'
import permissions from '../src/lib/backend/jazz/permissions.js'
type ImageEvidence = {
	machine: string
	status: string
	states: string[]
	error: string | undefined
}
const evidence = new WeakMap<Page, ImageEvidence[]>()
test.beforeEach(({ page }) => {
	const states: ImageEvidence[] = []
	evidence.set(page, states)
	page.on('console', (message) => {
		const text = message.text()
		if (!text.includes('clipper:machines')) return
		try {
			const value = JSON.parse(text.slice(text.indexOf('{')))
			if (
				![
					'image-queue',
					'image-failure-domain',
					'image-publication-domain',
					'domain-transaction',
					'workspace-creation-transaction'
				].includes(value.machine) ||
				typeof value.status !== 'string' ||
				!Array.isArray(value.states) ||
				!value.states.every((state: unknown) => typeof state === 'string')
			)
				return
			states.push({
				machine: value.machine,
				status: value.status,
				states: value.states,
				error: typeof value.error?.message === 'string' ? value.error.message : undefined
			})
			if (states.length > 100) states.shift()
		} catch {
			/* Ignore unrelated console output; never retain payloads or credentials. */
		}
	})
})
test.afterEach(async ({ page }, info) => {
	if (info.status === info.expectedStatus) return
	console.info(
		'Image workflow state evidence',
		JSON.stringify({
			retryVisible: await page
				.getByRole('button', { name: 'Retry', exact: true })
				.isVisible()
				.catch(() => false),
			states: evidence.get(page)
		})
	)
})
let authority: Awaited<ReturnType<typeof startLocalJazzServer>>, directory: string
const options = () => ({
	appId: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
	host: '127.0.0.1',
	port: 5181,
	dataDir: directory,
	schema: app,
	permissions
})
test.beforeAll(async () => {
	directory = await mkdtemp(join(tmpdir(), 'clipper-images-browser-'))
	authority = await startLocalJazzServer(options())
})
test.afterAll(async () => {
	await authority.stop()
	await rm(directory, { recursive: true, force: true })
})
async function png(page: Page, width = 3000, height = 1000, mediaType = 'image/png') {
	return Buffer.from(
		await page.evaluate(
			async ({ width, height, mediaType }) => {
				const canvas = document.createElement('canvas')
				canvas.width = width
				canvas.height = height
				const context = canvas.getContext('2d')!
				context.fillStyle = '#204060'
				context.fillRect(0, 0, width, height)
				const blob = await new Promise<Blob>((resolve, reject) =>
					canvas.toBlob(
						(blob) => (blob ? resolve(blob) : reject(new Error('Fixture encoding failed'))),
						mediaType
					)
				)
				return Array.from(new Uint8Array(await blob.arrayBuffer()))
			},
			{ width, height, mediaType }
		)
	)
}
async function seed(page: Page, urls: string[]) {
	await page.goto('/')
	await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
	const previous = new Set(
		await page
			.locator('[data-article-id]')
			.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-article-id')))
	)
	const url = 'https://example.com/images-' + crypto.randomUUID()
	const html = `<p>Saved text stays readable while images load.</p>${urls.map((url, index) => `<figure><img data-clipper-image="${encodeURIComponent(url)}" alt="Saved image ${index + 1}" src="https://images.example/never-load-from-reader.png"><figcaption>Figure ${index + 1}</figcaption></figure>`).join('')}<p>Article ending.</p>`
	const extract = async (route: import('@playwright/test').Route) => {
		const body: { operationId: string; url: string } = route.request().postDataJSON()
		const base = { operationId: body.operationId, finalUrl: body.url }
		await route.fulfill({
			json: route.request().url().endsWith('/resolve')
				? base
				: {
						...base,
						provenance: {
							submittedUrl: body.url,
							redirects: [],
							resolvedAt: new Date().toISOString()
						},
						candidate: {
							title: 'Offline image fixture',
							text: 'Saved text stays readable while images load. Article ending.',
							html,
							assetCandidates: [],
							partialEvidence: [],
							parserVersion: 'fixture',
							normalizationVersion: '1'
						}
					}
		})
	}
	await page.route('**/api/capture/{resolve,extract}', extract)
	try {
		await openAddLink(page)
		await page.getByLabel('Article URL', { exact: true }).fill(url)
		await page
			.getByRole('dialog', { name: 'Add link', exact: true })
			.getByRole('button', { name: 'Add link', exact: true })
			.click()
		const newIds = async () =>
			(
				await page
					.locator('[data-article-id]')
					.evaluateAll((rows) => rows.map((row) => row.getAttribute('data-article-id')))
			).filter((id) => !!id && !previous.has(id))
		await expect.poll(newIds).toHaveLength(1)
		const id = (await newIds())[0]!
		await expect(
			page
				.locator(`[data-article-id="${id}"]`)
				.getByRole('link', { name: 'Offline image fixture', exact: true })
		).toBeVisible()
		return id
	} finally {
		await page.unroute('**/api/capture/{resolve,extract}', extract)
	}
}
async function rows(page: Page): Promise<ArticleImage[]> {
	return page.evaluate(async () => {
		const path = '/tests/images-driver.ts'
		return (await import(/* @vite-ignore */ path)).imageRows()
	})
}
async function imageLoaded(page: Page, name = 'Saved image 1', width = 2048) {
	const image = page.getByRole('img', { name, exact: true }).filter({ visible: true })
	await expect
		.poll(async () =>
			image.evaluateAll((images) =>
				images
					.filter((image) => image instanceof HTMLImageElement)
					.map((image) => image.naturalWidth)
			)
		)
		.toContain(width)
}
test('shows text before image completion, resizes in a real worker, preserves selection and never loads source URLs', async ({
	page
}) => {
	const bytes = await png(page),
		gate = Promise.withResolvers<void>()
	let requests = 0
	const remote: string[] = []
	page.on('request', (request) => {
		if (new URL(request.url()).hostname === 'images.example') remote.push(request.url())
	})
	await page.route('**/api/capture/asset', async (route) => {
		requests++
		await gate.promise
		await route.fulfill({ status: 200, contentType: 'image/png', body: bytes })
	})
	await seed(page, ['https://images.example/photo.png'])
	await page.getByRole('link', { name: 'Offline image fixture', exact: true }).click()
	await expect(page.getByRole('article')).toContainText('Saved text stays readable')
	await page
		.getByRole('article')
		.locator('p')
		.first()
		.evaluate((node) => {
			const selection = window.getSelection()!
			const range = document.createRange()
			range.selectNodeContents(node)
			selection.removeAllRanges()
			selection.addRange(range)
		})
	gate.resolve()
	await imageLoaded(page)
	expect(await page.evaluate(() => window.getSelection()?.toString())).toContain(
		'Saved text stays readable'
	)
	expect(remote).toEqual([])
	expect(requests).toBe(1)
	await readingControls(page)
	await page.getByRole('link', { name: 'Open library', exact: true }).click()
	await page.getByRole('link', { name: 'Offline image fixture', exact: true }).click()
	await imageLoaded(page)
	expect(requests).toBe(1)
	const unauthenticated = await page.request.post('/api/capture/asset', {
		data: {
			protocolVersion: 1,
			operationId: crypto.randomUUID(),
			url: 'https://example.com/image.png'
		}
	})
	expect(unauthenticated.status()).toBe(401)
})
test('continues background acquisition after leaving the reader and retries a failed image without replacing text', async ({
	page
}) => {
	const bytes = await png(page, 20, 10),
		gate = Promise.withResolvers<void>(),
		failedResponse = Promise.withResolvers<void>(),
		urls = ['https://images.example/retry.png', 'https://images.example/slow.png']
	let failing = true
	let failedUrl: string | undefined
	await page.route('**/api/capture/asset', async (route) => {
		const { url } = route.request().postDataJSON()
		// Native declarations have no ordering guarantee. Fail the first acquired source
		// so a held request cannot block the serial queue before the failure assertion.
		failedUrl ??= url
		if (url !== failedUrl) await gate.promise
		if (url === failedUrl && failing) {
			await route.fulfill({ status: 415, json: { code: 'unsupportedMedia', retryable: false } })
			failedResponse.resolve()
		} else await route.fulfill({ status: 200, contentType: 'image/png', body: bytes })
	})
	await seed(page, urls)
	await page.getByRole('link', { name: 'Offline image fixture', exact: true }).click()
	// Cold native reconciliation may wait five seconds before the first fetch.
	// Observe the mocked response before timing its durable failure publication.
	await failedResponse.promise
	await expect.poll(async () => (await rows(page)).map((row) => row.status)).toContain('failed')
	const failedName = 'Saved image ' + (urls.findIndex((url) => url === failedUrl) + 1),
		backgroundName = 'Saved image ' + (urls.findIndex((url) => url !== failedUrl) + 1)
	await expect(page.getByRole('button', { name: 'Retry', exact: true })).toBeVisible()
	await readingControls(page)
	await page.getByRole('link', { name: 'Open library', exact: true }).click()
	gate.resolve()
	await expect
		.poll(async () => (await rows(page)).filter((row) => row.status === 'ready').length)
		.toBe(1)
	await page.getByRole('link', { name: 'Offline image fixture', exact: true }).click()
	await imageLoaded(page, backgroundName, 20)
	failing = false
	await page.getByRole('button', { name: 'Retry', exact: true }).click()
	await imageLoaded(page, failedName, 20)
	await expect(page.getByRole('article')).toContainText('Saved text stays readable')
	await expect
		.poll(async () => (await rows(page)).filter((row) => row.status === 'ready').length)
		.toBe(2)
})
test('persists processed native images across restart without Jazz and synchronizes them to a restored client', async ({
	browser
}) => {
	const profile = await mkdtemp(join(tmpdir(), 'clipper-images-profile-'))
	let context = await chromium.launchPersistentContext(profile, { headless: true })
	const independent = await browser.newContext()
	try {
		const page = await context.newPage(),
			bytes = await png(page, 24, 12)
		await page.route('**/api/capture/asset', (route) =>
			route.fulfill({ status: 200, contentType: 'image/png', body: bytes })
		)
		const id = await seed(page, ['https://images.example/offline.png'])
		const phrase = await readRecoveryPhrase(page)
		await page.getByRole('link', { name: 'Offline image fixture', exact: true }).click()
		await imageLoaded(page, 'Saved image 1', 24)
		const restored = await independent.newPage()
		await restored.goto('http://127.0.0.1:5180/')
		await restoreAccount(restored, phrase)
		await expect(restored.getByText('Private library synced.', { exact: true })).toBeVisible()
		await restored.getByRole('link', { name: 'Offline image fixture', exact: true }).click()
		await imageLoaded(restored, 'Saved image 1', 24)
		await authority.stop()
		await context.close()
		context = await chromium.launchPersistentContext(profile, { headless: true })

		const reopened = await context.newPage()
		await reopened.goto('http://127.0.0.1:5180/articles/' + id)
		await imageLoaded(reopened, 'Saved image 1', 24)
		await expect(reopened.getByRole('article')).toContainText('Saved text stays readable')
	} finally {
		await context.close()
		await independent.close()
		authority = await startLocalJazzServer(options())
		await rm(profile, { recursive: true, force: true })
	}
})

test('processes JPEG, WebP and GIF sources in the real browser worker without upscaling', async ({
	page
}) => {
	const fixtures = {
		jpeg: { bytes: await png(page, 64, 32, 'image/jpeg'), mediaType: 'image/jpeg', width: 64 },
		webp: { bytes: await png(page, 64, 32, 'image/webp'), mediaType: 'image/webp', width: 64 },
		gif: {
			bytes: Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
			mediaType: 'image/gif',
			width: 1
		}
	}
	expect(fixtures.jpeg.bytes[0]).toBe(255)
	expect(fixtures.webp.bytes.subarray(0, 4).toString()).toBe('RIFF')
	for (const [name, fixture] of Object.entries(fixtures)) {
		await page.route('**/api/capture/asset', (route) =>
			route.fulfill({ status: 200, contentType: fixture.mediaType, body: fixture.bytes })
		)
		const id = await seed(page, ['https://images.example/' + name])
		await page.locator('a[href="/articles/' + id + '"]').click()
		await imageLoaded(page, 'Saved image 1', fixture.width)
		await page.unroute('**/api/capture/asset')
	}
})
