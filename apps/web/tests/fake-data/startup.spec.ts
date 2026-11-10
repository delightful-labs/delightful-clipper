import { readRecoveryPhrase, restoreAccount } from '../account-ui.js'
import { readingControls } from '../reader-ui.js'
import { openLibrarySearch, openLibraryFilters } from '../library-popovers.js'
import { test, expect } from '@playwright/test'
import { startLocalJazzServer } from '../browser-core.js'
import { app } from '../../src/lib/backend/jazz/schema.js'
import permissions from '../../src/lib/backend/jazz/permissions.js'
let authority: Awaited<ReturnType<typeof startLocalJazzServer>>
const authorityOptions = {
	appId: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
	host: '127.0.0.1',
	port: 5183,
	inMemory: true,
	schema: app,
	permissions
}
test.beforeAll(async () => {
	authority = await startLocalJazzServer(authorityOptions)
})
test.afterAll(async () => {
	await authority?.stop()
})
test('flag-enabled startup populates a real library once and preserves edits, readers, search and restored clients', async ({
	page,
	browser
}) => {
	const requests: string[] = [],
		warnings: string[] = []
	page.on('request', (request) => {
		if (request.url().includes('/api/capture/')) requests.push(request.url())
	})
	page.on('console', (message) => {
		if (
			message.type() === 'warning' &&
			(message.text().includes('Custom actions should not call') ||
				message.text().includes('stopped actor'))
		)
			warnings.push(message.text())
	})
	await page.goto('/')
	const rows = page.locator('[data-article-id]')
	await expect(rows).toHaveCount(22, { timeout: 30000 })
	await expect(rows.first().getByRole('heading')).not.toContainText('https://example.invalid')
	const originalIds = await rows.evaluateAll((items) =>
		items.map((item) => item.getAttribute('data-article-id')).sort()
	)
	const first = rows.first(),
		id = await first.getAttribute('data-article-id')
	await first.getByLabel('Status', { exact: true }).selectOption('archive')
	await expect(first.getByLabel('Status', { exact: true })).toBeEnabled()
	await first.getByRole('button', { name: 'tags', exact: true }).click()
	const tags = page.getByRole('dialog', { name: 'tags', exact: true })
	await expect(
		tags.getByRole('list', { name: 'tags', exact: true }).getByRole('listitem')
	).toHaveCount(1)
	await tags.getByRole('button', { name: 'Close', exact: true }).click()
	await first.getByRole('heading').getByRole('link').click()
	await expect
		.poll(async () => (await page.getByRole('article').textContent())?.length ?? 0)
		.toBeGreaterThan(200)
	await readingControls(page)
	await page.getByRole('link', { name: 'Open library', exact: true }).click()
	await openLibrarySearch(page)
	const search = page.getByRole('searchbox', { name: 'Search articles', exact: true })
	await openLibrarySearch(page)
	await search.fill('no-such-sample-word-394823')
	await expect(rows).toHaveCount(0)
	await openLibrarySearch(page)
	await search.fill('')
	await openLibraryFilters(page)
	await page.getByRole('radio', { name: 'Trash', exact: true }).check()
	await expect(rows).toHaveCount(2)
	await openLibraryFilters(page)
	await page.getByRole('radio', { name: 'All', exact: true }).check()
	await page.reload()
	await expect(rows).toHaveCount(22)
	expect(
		await rows.evaluateAll((items) =>
			items.map((item) => item.getAttribute('data-article-id')).sort()
		)
	).toEqual(originalIds)
	await expect(
		page.locator(`[data-article-id="${id}"]`).getByLabel('Status', { exact: true })
	).toHaveValue('archive')
	const phrase = await readRecoveryPhrase(page)
	const otherContext = await browser.newContext()
	try {
		const other = await otherContext.newPage()
		await other.goto('/')
		await restoreAccount(other, phrase)
		await expect(other.locator(`[data-article-id="${id}"]`)).toBeVisible({ timeout: 30000 })
		await expect(other.locator('[data-article-id]')).toHaveCount(22)
		await expect(
			other.locator(`[data-article-id="${id}"]`).getByLabel('Status', { exact: true })
		).toHaveValue('archive')
	} finally {
		await otherContext.close()
	}
	expect(requests).toEqual([])
	expect(warnings).toEqual([])
})

test('an offline empty library remains usable without Faker or seed writes', async ({ page }) => {
	await authority.stop()
	const imported: string[] = []
	page.on('request', (request) => {
		if (request.url().includes('/samples/plan.ts')) imported.push(request.url())
	})
	try {
		await page.goto('/')
		await expect(page.getByRole('region', { name: 'Saved articles' })).toBeVisible({
			timeout: 4000
		})
		await expect(page.getByRole('button', { name: 'Add link', exact: true })).toBeEnabled()
		await expect(page.locator('[data-article-id]')).toHaveCount(0)
		expect(imported).toEqual([])
	} finally {
		await page.close()
		authority = await startLocalJazzServer(authorityOptions)
	}
})
