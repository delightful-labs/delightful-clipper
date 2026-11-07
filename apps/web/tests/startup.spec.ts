import { test, expect } from '@playwright/test'
import { startLocalJazzServer } from 'jazz-tools/testing'
import { app } from '../src/lib/backend/jazz/schema.js'
import permissions from '../src/lib/backend/jazz/permissions.js'
import { openLibrarySearch, closeLibraryPopovers, openLibraryFilters } from './library-popovers.js'
declare global {
	interface Window {
		startupWorkers: string[]
	}
}
let authority: Awaited<ReturnType<typeof startLocalJazzServer>>
test.beforeAll(async () => {
	authority = await startLocalJazzServer({
		appId: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
		host: '127.0.0.1',
		port: 5181,
		inMemory: true,
		schema: app,
		permissions
	})
})
test.afterAll(async () => {
	await authority?.stop()
})

test('populated restart bounds rendering, starts search on demand and reads directly without indexing', async ({
	page
}) => {
	test.setTimeout(90000)
	await page.addInitScript(() => {
		const workers: string[] = []
		Object.assign(window, { startupWorkers: workers })
		const NativeWorker = window.Worker
		window.Worker = class extends NativeWorker {
			constructor(url: string | URL, options?: WorkerOptions) {
				workers.push(String(url))
				super(url, options)
			}
		}
	})
	const rootStates: string[] = []
	page.on('console', (message) => {
		const text = message.text()
		if (text.includes('"machine":"root-bootstrap"')) rootStates.push(text)
	})
	await page.goto('/')
	await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
	const ids = await page.evaluate(async () => {
		const path = '/tests/startup-driver.ts'
		return (await import(/* @vite-ignore */ path)).seedStartupLibrary(120)
	})
	rootStates.length = 0
	await page.reload()
	const rows = page.locator('[data-article-id]')
	await expect(rows).toHaveCount(50)
	await expect(page.locator(`[data-article-id="${ids[0]}"]`)).toHaveCount(0)
	const hasSearchWorker = () =>
		page.evaluate(() => window.startupWorkers.some((path) => path.includes('/search/worker.ts')))
	expect(await hasSearchWorker()).toBe(false)
	await expect(page.getByText('Private library synced.', { exact: true })).toHaveCount(0)
	await expect.poll(() => rootStates.some((state) => state.includes('existing'))).toBe(true)
	expect(rootStates.some((state) => state.includes('writing.'))).toBe(false)
	await page.getByRole('button', { name: 'Show articles', exact: true }).click()
	await expect(rows).toHaveCount(100)
	await expect(rows.nth(50)).toBeFocused()
	await page.getByRole('button', { name: 'Show articles', exact: true }).click()
	await expect(rows).toHaveCount(120)
	await expect(rows.nth(100)).toBeFocused()
	await expect(page.getByRole('button', { name: 'Show articles', exact: true })).toHaveCount(0)
	await openLibrarySearch(page)
	await page
		.getByRole('searchbox', { name: 'Search articles', exact: true })
		.fill('uniquestartupneedle')
	await expect(rows).toHaveCount(1)
	await expect(rows).toHaveAttribute('data-article-id', ids[0]!)
	expect(await hasSearchWorker()).toBe(true)
	await page.getByRole('searchbox', { name: 'Search articles', exact: true }).fill('')
	await expect(rows).toHaveCount(50)
	await closeLibraryPopovers(page)
	await openLibraryFilters(page)
	await page.getByRole('radio', { name: 'Archive', exact: true }).check()
	await expect(rows).toHaveCount(0)
	await page.getByRole('radio', { name: 'All', exact: true }).check()
	await expect(rows).toHaveCount(50)
	await closeLibraryPopovers(page)
	await page.goto('/articles/' + ids[0])
	await expect(page.getByRole('article')).toContainText('uniquestartupneedle')
	expect(await hasSearchWorker()).toBe(false)
})
