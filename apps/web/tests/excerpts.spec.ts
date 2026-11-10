import { test, expect } from '@playwright/test'
import { createJazz, remote, acceptLocalFirstAuth } from 'jazz-tools/backend'
import { app } from '../src/lib/backend/jazz/schema.js'
import permissions from '../src/lib/backend/jazz/permissions.js'
import { browserCoreSecret } from './browser-core.js'
import { startLocalJazzServer } from './browser-core.js'
import { openAddLink } from './add-link.js'

let audit: ReturnType<typeof createJazz>
let authority: Awaited<ReturnType<typeof startLocalJazzServer>>
test.beforeAll(async () => {
	authority = await startLocalJazzServer({
		appId: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
		host: '127.0.0.1',
		port: 5181,
		inMemory: true
	})
	audit = createJazz({
		app,
		permissions,
		store: remote({ url: authority.url, appId: authority.appId, secret: browserCoreSecret }),
		authenticate: acceptLocalFirstAuth
	})
	await audit.ready()
})
test.afterAll(async () => {
	await audit?.close()
	await authority?.stop()
})

for (const width of [1440, 390]) {
	test(`captures and retains a plain parser excerpt below the title at ${width}px`, async ({
		page
	}) => {
		await page.setViewportSize({ width, height: 900 })
		let extractions = 0
		let imageFetches = 0
		const imageData = await page.evaluate(() => {
			const canvas = document.createElement('canvas')
			canvas.width = 16
			canvas.height = 8
			canvas.getContext('2d')!.fillRect(0, 0, 16, 8)
			return canvas.toDataURL('image/png').split(',')[1]!
		})
		const metadata = {
			author: 'Ada Example',
			siteName: 'Example Journal',
			publishedTime: '2026-10-02T12:30:00+02:00',
			lang: 'ar',
			dir: 'rtl',
			featuredImageUrl: 'https://example.com/cover.png'
		}
		const excerpt =
			'Preview with <strong>literal markup</strong>. ' +
			'A useful description of the saved article. '.repeat(12)
		await page.route('**/api/capture/*', async (route) => {
			if (route.request().url().endsWith('/asset')) {
				imageFetches++
				await route.fulfill({
					status: 200,
					contentType: 'image/png',
					body: Buffer.from(imageData, 'base64')
				})
				return
			}
			const input: { operationId: string; url: string } = route.request().postDataJSON()
			const base = { operationId: input.operationId, finalUrl: input.url }
			if (route.request().url().endsWith('/resolve')) {
				await route.fulfill({ json: base })
				return
			}
			extractions++
			await route.fulfill({
				json: {
					...base,
					candidate: {
						title: 'Excerpt fixture',
						...metadata,
						excerpt,
						text: 'The full body is saved separately.',
						html: '<p>The full body is saved separately.</p>'
					}
				}
			})
		})
		await page.goto('/')
		const dialog = await openAddLink(page)
		await dialog.getByLabel('Article URL', { exact: true }).fill('https://example.com/excerpt')
		await dialog.getByRole('button', { name: 'Add link', exact: true }).click()
		const row = page.locator('[data-article-id]')
		const preview = row.locator('.article-excerpt')
		await expect(row.getByRole('link', { name: 'Excerpt fixture', exact: true })).toBeVisible()
		await expect(preview).toContainText('Preview with <strong>literal markup</strong>.')
		await expect(preview).not.toContainText('The full body')
		await expect(preview.locator('strong')).toHaveCount(0)
		const id = await row.getAttribute('data-article-id')
		if (!id) throw new Error('Missing article ID')
		await expect
			.poll(() => audit.db.one(app.snapshots.where({ id })))
			.toMatchObject({ excerpt, ...metadata })
		await expect
			.poll(() =>
				audit.db.one(
					app.articleImages.where({ documentId: id, sourceUrl: metadata.featuredImageUrl })
				)
			)
			.toMatchObject({ status: 'ready' })
		const image = await audit.db.one(
			app.articleImages.where({ documentId: id, sourceUrl: metadata.featuredImageUrl })
		)
		expect(
			(await audit.db.one(app.assets.where({ id: image!.assetId! })))?.payload.byteLength
		).toBeGreaterThan(0)
		const text = await preview.innerText()
		expect(text.length).toBeLessThanOrEqual(240)
		expect(text.endsWith('…')).toBe(true)
		const titleBounds = await row.getByRole('heading').boundingBox()
		const previewBounds = await preview.boundingBox()
		expect(previewBounds!.y).toBeGreaterThanOrEqual(titleBounds!.y + titleBounds!.height)
		if (width === 390)
			expect(await preview.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(
				true
			)
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
		await expect(
			row.getByRole('button', { name: 'Article actions', exact: true })
		).toHaveAccessibleDescription('Excerpt fixture')
		await page.reload()
		await expect(preview).toHaveText(text)
		expect(extractions).toBe(1)
		expect(imageFetches).toBe(1)
		expect(await audit.db.one(app.snapshots.where({ id }))).toMatchObject({ excerpt, ...metadata })
	})
}
