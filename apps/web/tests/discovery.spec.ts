import { closeLibraryPopovers, openLibrarySearch, openLibraryFilters } from './library-popovers.js'
import { test, expect, chromium } from '@playwright/test'
import type { Page } from '@playwright/test'
import { startLocalJazzServer } from './browser-core.js'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from '../src/lib/backend/jazz/schema.js'
import permissions from '../src/lib/backend/jazz/permissions.js'
import { openAddLink } from './add-link.js'
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
	directory = await mkdtemp(join(tmpdir(), 'clipper-discovery-browser-'))
	authority = await startLocalJazzServer(options())
})
test.afterAll(async () => {
	await authority.stop()
	await rm(directory, { recursive: true, force: true })
})
async function supplied(page: Page, url: string) {
	const result = await page.evaluate(async (url) => {
		const path = '/tests/article-driver.ts'
		return (await import(/* @vite-ignore */ path)).supplied(url)
	}, url)
	const row = page.locator(`[data-article-id="${result.id}"]`)
	await expect(row).toBeVisible()
	return { row, id: result.id }
}
async function tags(page: Page, row: ReturnType<Page['locator']>) {
	await closeLibraryPopovers(page)
	await row.getByRole('button', { name: 'tags', exact: true }).click()
	const dialog = page.getByRole('dialog', { name: 'tags', exact: true })
	await expect(dialog).toBeVisible()
	return dialog
}
test('creates Unicode-equivalent tags once, changes membership and combines tag/status/favorite filters', async ({
	page
}) => {
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const first = await supplied(page, 'https://example.com/tag-first'),
		second = await supplied(page, 'https://example.com/tag-second')
	let dialog = await tags(page, first.row)
	await dialog.locator('input[type="text"]').fill(' Straße ')
	await dialog.getByRole('button', { name: 'Add tag', exact: true }).click()
	await expect(dialog.getByRole('button', { name: 'Remove Straße', exact: true })).toBeVisible()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	dialog = await tags(page, second.row)
	await dialog.locator('input[type="text"]').fill('STRASSE')
	await dialog.getByRole('button', { name: 'Add tag', exact: true }).click()
	await expect(
		dialog.getByRole('list', { name: 'tags', exact: true }).getByRole('listitem')
	).toHaveCount(1)
	await expect(dialog.getByRole('button', { name: 'Remove Straße', exact: true })).toBeVisible()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await openLibraryFilters(page)
	const filter = page.getByRole('group', { name: 'tags', exact: true }).getByRole('checkbox')
	await expect(filter).toHaveCount(1)
	await filter.check()
	await expect(first.row).toBeVisible()
	await expect(second.row).toBeVisible()
	dialog = await tags(page, second.row)
	await dialog.getByRole('button', { name: 'Remove Straße', exact: true }).click()
	await expect(dialog.getByRole('button', { name: 'Remove Straße', exact: true })).toHaveCount(0)
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await expect(second.row).toHaveCount(0)
	await expect(page.getByRole('heading', { name: 'Saved articles', exact: true })).toBeFocused()
	await first.row.getByLabel('Status', { exact: true }).selectOption('later')
	await expect(first.row.getByLabel('Status', { exact: true })).toBeEnabled()
	await closeLibraryPopovers(page)
	await first.row.getByRole('button', { name: 'Favorite', exact: true }).click()
	await openLibraryFilters(page)
	await page.getByRole('radio', { name: 'Later', exact: true }).check()
	await openLibraryFilters(page)
	await page.getByRole('button', { name: 'Favorites', exact: true }).click()
	await expect(first.row).toBeVisible()
	await page.reload()
	await expect(first.row).toBeVisible()
	dialog = await tags(page, first.row)
	await expect(dialog.getByRole('button', { name: 'Remove Straße', exact: true })).toBeVisible()
})
test('Trash controls preserve content/organization and duplicate Add Link offers explicit Restore', async ({
	page
}) => {
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const url = 'https://example.com/trash-duplicate',
		item = await supplied(page, url)
	await item.row.getByLabel('Status', { exact: true }).selectOption('later')
	await expect(item.row.getByLabel('Status', { exact: true })).toBeEnabled()
	await closeLibraryPopovers(page)
	await item.row.getByRole('button', { name: 'Favorite', exact: true }).click()
	const before = await page.evaluate(async (url) => {
		const path = '/tests/article-driver.ts'
		return (await import(/* @vite-ignore */ path)).inspect([url])
	}, url)
	await closeLibraryPopovers(page)
	await item.row.getByRole('button', { name: 'Move to Trash', exact: true }).click()
	await expect(item.row).toHaveCount(0)
	await expect(page.getByRole('heading', { name: 'Saved articles', exact: true })).toBeFocused()
	await openLibraryFilters(page)
	await page.getByRole('radio', { name: 'Trash', exact: true }).check()
	await expect(item.row).toBeVisible()
	await expect(item.row.getByLabel('Status', { exact: true })).toHaveValue('later')
	await openLibraryFilters(page)
	await page.getByRole('radio', { name: 'All', exact: true }).check()
	await expect(item.row).toHaveCount(0)
	const dialog = await openAddLink(page)
	await dialog.getByLabel('Article URL', { exact: true }).fill(url)
	await dialog.getByRole('button', { name: 'Add link', exact: true }).click()
	await expect(page.getByRole('button', { name: 'Restore article', exact: true })).toBeVisible()
	await page.getByRole('button', { name: 'Restore article', exact: true }).click()
	await expect(item.row).toBeVisible()
	await expect(item.row.getByLabel('Status', { exact: true })).toHaveValue('later')
	await expect(item.row.getByRole('button', { name: 'Remove favorite', exact: true })).toBeVisible()
	const after = await page.evaluate(async (url) => {
		const path = '/tests/article-driver.ts'
		return (await import(/* @vite-ignore */ path)).inspect([url])
	}, url)
	expect(after).toEqual(before)
})
test('real browser worker searches saved body and URL offline, scopes Trash, and rebuilds a missing cache', async ({
	page
}) => {
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const first = await supplied(page, 'https://example.com/search-needle'),
		second = await supplied(page, 'https://example.com/search-other')
	const search = (
		query: string,
		scope: 'all' | 'trash' = 'all',
		trashed: string[] = []
	): Promise<{ id: string }[]> =>
		page.evaluate(
			async ({ query, scope, trashed }) => {
				const path = '/tests/article-driver.ts'
				return (await import(/* @vite-ignore */ path)).searchSaved(query, scope, 2, trashed)
			},
			{ query, scope, trashed }
		)
	expect((await search('browser clip')).map((row) => row.id).sort()).toEqual(
		[first.id, second.id].sort()
	)
	expect((await search('needle')).map((row) => row.id)).toEqual([first.id])
	await page.evaluate(async () => {
		await new Promise<void>((resolve, reject) => {
			const request = indexedDB.deleteDatabase('delightful-clipper-search-v1')
			request.onsuccess = () => resolve()
			request.onerror = () => reject(new Error('Cache deletion failed'))
		})
	})
	await page.evaluate(async () => {
		const path = '/tests/article-driver.ts'
		await (await import(/* @vite-ignore */ path)).resetSearchSaved()
	})
	await search('browser clip')
	await page.context().setOffline(true)
	expect((await search('browser clip')).map((row) => row.id).sort()).toEqual(
		[first.id, second.id].sort()
	)
	await page.context().setOffline(false)
	await page.evaluate(async () => {
		const path = '/tests/article-driver.ts'
		return (await import(/* @vite-ignore */ path)).organize('https://example.com/search-needle', {
			field: 'trashed',
			value: true
		})
	})
	expect(await search('needle', 'all', [first.id])).toEqual([])
	expect((await search('needle', 'trash', [first.id])).map((row) => row.id)).toEqual([first.id])
})

async function phrase(page: Page) {
	await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
	const dialog = page.getByRole('dialog')
	const value = await dialog.getByLabel('Recovery phrase', { exact: true }).inputValue()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	return value
}
async function addTag(page: Page, row: ReturnType<Page['locator']>, name: string) {
	const dialog = await tags(page, row)
	await dialog.locator('input[type="text"]').fill(name)
	await dialog.getByRole('button', { name: 'Add tag', exact: true }).click()
	await expect(dialog.getByRole('button', { name: `Remove ${name}`, exact: true })).toBeVisible()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
}
test('merges offline independent tag changes across restored clients and preserves them through Trash/restore', async ({
	page,
	browser
}) => {
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const url = 'https://example.com/tags-two-clients',
		item = await supplied(page, url)
	await item.row.getByLabel('Status', { exact: true }).selectOption('later')
	await expect(item.row.getByLabel('Status', { exact: true })).toBeEnabled()
	await closeLibraryPopovers(page)
	await item.row.getByRole('button', { name: 'Favorite', exact: true }).click()
	const recovery = await phrase(page)
	const otherContext = await browser.newContext()
	let stopped = false
	try {
		const other = await otherContext.newPage()
		await other.goto('http://127.0.0.1:5180')
		await other.getByLabel('Recovery phrase', { exact: true }).fill(recovery)
		await other.getByRole('button', { name: 'Restore account', exact: true }).click()
		const remote = other.locator(`[data-article-id="${item.id}"]`)
		await expect(remote).toBeVisible()
		await expect(remote.getByRole('button', { name: 'Remove favorite', exact: true })).toBeVisible()
		await authority.stop()
		stopped = true
		await addTag(page, item.row, 'First')
		await addTag(other, remote, 'Second')
		await remote.getByRole('button', { name: 'Remove favorite', exact: true }).click()
		await page.evaluate(async (url) => {
			const path = '/tests/article-driver.ts'
			return (await import(/* @vite-ignore */ path)).organize(
				url,
				{ field: 'trashed', value: true },
				false
			)
		}, url)
		await expect(item.row).toHaveCount(0)
		authority = await startLocalJazzServer(options())
		stopped = false
		await expect(remote).toHaveCount(0)
		const dialog = await openAddLink(page)
		await dialog.getByLabel('Article URL', { exact: true }).fill(url)
		await dialog.getByRole('button', { name: 'Add link', exact: true }).click()
		await page.getByRole('button', { name: 'Restore article', exact: true }).click()
		await expect(item.row).toBeVisible()
		await expect(remote).toBeVisible()
		await expect(item.row.getByLabel('Status', { exact: true })).toHaveValue('later')
		await expect(item.row.getByRole('button', { name: 'Favorite', exact: true })).toBeVisible()
		const tagDialog = await tags(page, item.row)
		await expect(tagDialog.getByRole('button', { name: 'Remove First', exact: true })).toBeVisible()
		await expect(
			tagDialog.getByRole('button', { name: 'Remove Second', exact: true })
		).toBeVisible()
	} finally {
		await otherContext.close()
		if (stopped) authority = await startLocalJazzServer(options())
	}
})
test('persists tags and Trash across a complete offline browser restart and restores the same reader', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'clipper-discovery-profile-'))
	let context = await chromium.launchPersistentContext(profile, {
		headless: true,
		baseURL: 'http://127.0.0.1:5180'
	})
	let stopped = false
	try {
		let page = await context.newPage()
		await page.goto('/')
		await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
		const url = 'https://example.com/tags-offline-restart',
			item = await supplied(page, url)
		await addTag(page, item.row, 'Offline')
		await authority.stop()
		stopped = true
		await page.evaluate(async (url) => {
			const path = '/tests/article-driver.ts'
			return (await import(/* @vite-ignore */ path)).organize(
				url,
				{ field: 'trashed', value: true },
				false
			)
		}, url)
		await expect(item.row).toHaveCount(0)
		await context.close()
		context = await chromium.launchPersistentContext(profile, {
			headless: true,
			baseURL: 'http://127.0.0.1:5180'
		})
		page = await context.newPage()
		await page.goto(`/articles/${item.id}`)
		await expect(page.getByRole('article')).toContainText('Content supplied by a browser clip.')
		await page.getByRole('button', { name: 'Restore article', exact: true }).click()
		await expect(page.getByRole('button', { name: 'Restore article', exact: true })).toHaveCount(0)
		await page.getByRole('link', { name: 'Open library', exact: true }).click()
		const restored = page.locator(`[data-article-id="${item.id}"]`)
		await expect(restored).toBeVisible()
		const dialog = await tags(page, restored)
		await expect(dialog.getByRole('button', { name: 'Remove Offline', exact: true })).toBeVisible()
		await dialog.getByRole('button', { name: 'Close', exact: true }).click()
		const result = await page.evaluate(async () => {
			const path = '/tests/article-driver.ts'
			return (await import(/* @vite-ignore */ path)).searchSaved('browser clip', 'all', 1)
		})
		expect(result.map((row: { id: string }) => row.id)).toEqual([item.id])
	} finally {
		await context.close()
		if (stopped) authority = await startLocalJazzServer(options())
		await rm(profile, { recursive: true, force: true })
	}
})

test('reindexes a snapshot arriving from another restored client without restarting search', async ({
	page,
	browser
}) => {
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const recovery = await phrase(page)
	await openLibrarySearch(page)
	const search = page.getByRole('searchbox', { name: 'Search articles', exact: true })
	await openLibrarySearch(page)
	await search.fill('arriving')
	await expect(
		page.getByText('No saved articles on this device yet.', { exact: true })
	).toBeVisible()
	const otherContext = await browser.newContext()
	try {
		const other = await otherContext.newPage()
		await other.goto('http://127.0.0.1:5180')
		await other.getByLabel('Recovery phrase', { exact: true }).fill(recovery)
		await other.getByRole('button', { name: 'Restore account', exact: true }).click()
		await expect(other.getByText('Private library synced.', { exact: true })).toBeVisible()
		const saved = await supplied(other, 'https://example.com/arriving')
		await expect(page.locator(`[data-article-id="${saved.id}"]`)).toBeVisible()
		await expect(search).toHaveValue('arriving')
		await openLibrarySearch(page)
		await search.fill('ResearchOnlyTag')
		await expect(page.locator(`[data-article-id="${saved.id}"]`)).toHaveCount(0)
		await addTag(other, saved.row, 'ResearchOnlyTag')
		await expect(page.locator(`[data-article-id="${saved.id}"]`)).toBeVisible()
		await openLibrarySearch(page)
		await search.fill('RESEARCHONLYTAG browser')
		await expect(page.locator(`[data-article-id="${saved.id}"]`)).toBeVisible()
		const dialog = await tags(other, saved.row)
		await dialog.getByRole('button', { name: 'Remove ResearchOnlyTag', exact: true }).click()
		await expect(
			dialog.getByRole('button', { name: 'Remove ResearchOnlyTag', exact: true })
		).toHaveCount(0)
		await expect(page.locator(`[data-article-id="${saved.id}"]`)).toHaveCount(0)
	} finally {
		await otherContext.close()
	}
})

test('search input combines title, URL and body keywords with status, favorites, tags and Trash', async ({
	page
}) => {
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const first = await supplied(page, 'https://example.com/ui-needle')
	const second = await supplied(page, 'https://example.com/ui-other')
	await first.row.getByLabel('Status', { exact: true }).selectOption('later')
	await expect(first.row.getByLabel('Status', { exact: true })).toBeEnabled()
	await closeLibraryPopovers(page)
	await first.row.getByRole('button', { name: 'Favorite', exact: true }).click()
	await addTag(page, first.row, 'Work')
	await addTag(page, first.row, 'Continues')
	await openLibrarySearch(page)
	const search = page.getByRole('searchbox', { name: 'Search articles', exact: true })
	await openLibrarySearch(page)
	await search.fill('continue browser')
	await expect(first.row).toBeVisible()
	await expect(second.row).toHaveCount(0)
	await openLibrarySearch(page)
	await search.fill('continus browsr')
	await expect(first.row).toBeVisible()
	await expect(second.row).toHaveCount(0)
	await openLibrarySearch(page)
	await search.fill('SUPPLIED')
	await expect(first.row).toBeVisible()
	await expect(second.row).toBeVisible()
	await openLibrarySearch(page)
	await search.fill('NEEDLE')
	await expect(first.row).toBeVisible()
	await expect(second.row).toHaveCount(0)
	await openLibrarySearch(page)
	await search.fill('browser clip')
	await expect(second.row).toBeVisible()
	await openLibraryFilters(page)
	await page.getByRole('radio', { name: 'Later', exact: true }).check()
	await expect(first.row).toBeVisible()
	await expect(second.row).toHaveCount(0)
	await openLibraryFilters(page)
	await page.getByRole('button', { name: 'Favorites', exact: true }).click()
	await page
		.getByRole('group', { name: 'tags', exact: true })
		.getByRole('checkbox', { name: 'Work' })
		.check()
	await openLibrarySearch(page)
	await search.fill('other')
	await expect(first.row).toHaveCount(0)
	await expect(page.getByText('No articles match this view.', { exact: true })).toBeVisible()
	await openLibrarySearch(page)
	await search.fill('browser clip')
	await expect(first.row).toBeVisible()
	await closeLibraryPopovers(page)
	await first.row.getByRole('button', { name: 'Move to Trash', exact: true }).click()
	await expect(first.row).toHaveCount(0)
	await openLibraryFilters(page)
	await page.getByRole('radio', { name: 'Trash', exact: true }).check()
	await expect(first.row).toBeVisible()
	await expect(second.row).toHaveCount(0)
	await closeLibraryPopovers(page)
	await first.row.getByRole('button', { name: 'Restore article', exact: true }).click()
	await expect(first.row).toHaveCount(0)
	await openLibraryFilters(page)
	await page.getByRole('radio', { name: 'All', exact: true }).check()
	await expect(first.row).toBeVisible()
	await openLibrarySearch(page)
	await search.fill('')
	await expect(first.row).toBeVisible()
	await expect(page.getByText('Preparing search…', { exact: true })).toHaveCount(0)
})

test('search failure is localized, leaves the library usable and retries with a fresh worker', async ({
	page
}) => {
	await page.goto('/')
	await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
	const application = page.workers().find((worker) => worker.url().includes('application.worker'))
	if (!application) throw new Error('Application worker unavailable')
	await application.evaluate(() => {
		const NativeWorker = globalThis.Worker
		let failed = false
		globalThis.Worker = class extends NativeWorker {
			constructor(url: string | URL, options?: WorkerOptions) {
				if (!failed && String(url).includes('/search/worker')) {
					failed = true
					throw new Error('Fixture search worker unavailable')
				}
				super(url, options)
			}
		}
	})
	await expect(page.getByText('Search is unavailable.', { exact: true })).toHaveCount(0)
	await openLibrarySearch(page)
	await expect(page.getByText('Search is unavailable.', { exact: true })).toBeVisible()
	const saved = await supplied(page, 'https://example.com/retry-search')
	await openLibrarySearch(page)
	const search = page.getByRole('searchbox', { name: 'Search articles', exact: true })
	await openLibrarySearch(page)
	await search.fill('browser clip')
	await page.getByRole('button', { name: 'Retry', exact: true }).click()
	await expect(page.getByText('Search is unavailable.', { exact: true })).toHaveCount(0)
	await expect(saved.row).toBeVisible()
	await openLibrarySearch(page)
	await search.fill('no-such-keyword')
	await expect(saved.row).toHaveCount(0)
})

test('tag validation uses the shared generic field error and clears it on edit and Escape', async ({
	page
}) => {
	const warnings: string[] = []
	page.on('console', (message) => {
		if (message.type() === 'warning' && message.text().includes('Custom actions should not call'))
			warnings.push(message.text())
	})
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const item = await supplied(page, 'https://example.com/tag-validation')
	const dialog = await tags(page, item.row)
	const input = dialog.locator('input[type="text"]')
	const add = dialog.getByRole('button', { name: 'Add tag', exact: true })
	await input.fill('a'.repeat(65))
	await add.click()
	await expect(dialog.locator('p').filter({ hasText: /^Enter tag$/ })).toBeVisible()
	await expect(input).toHaveAttribute('aria-invalid', 'true')
	await input.fill('a'.repeat(65))
	await add.click()
	await expect(dialog.getByRole('list', { name: 'tags', exact: true })).toHaveCount(0)
	await expect(dialog.locator('p').filter({ hasText: /^Enter tag$/ })).toBeVisible()
	await input.fill('Valid')
	await expect(dialog.locator('p').filter({ hasText: /^Enter tag$/ })).toHaveCount(0)
	await add.click()
	await expect(dialog.getByRole('button', { name: 'Remove Valid', exact: true })).toBeVisible()
	await input.fill('Draft')
	await page.keyboard.press('Escape')
	await expect(item.row.getByRole('button', { name: 'tags', exact: true })).toBeFocused()
	await tags(page, item.row)
	await expect(input).toHaveValue('')
	await expect(dialog.locator('p').filter({ hasText: /^Enter tag$/ })).toHaveCount(0)
	expect(warnings).toEqual([])
})

test('DUI TagInput selects suggestions with the keyboard, rejects duplicates and removes chips persistently', async ({
	page
}) => {
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const first = await supplied(page, 'https://example.com/dui-first')
	const second = await supplied(page, 'https://example.com/dui-second')
	await addTag(page, first.row, 'Reading')
	const dialog = await tags(page, second.row)
	const input = dialog.getByRole('combobox')
	await input.fill('Read')
	await input.press('ArrowDown')
	await input.press('Enter')
	await expect(dialog.getByRole('button', { name: 'Remove Reading', exact: true })).toBeVisible()
	await expect(input).toBeEditable()
	await expect(input).toBeFocused()
	await input.fill('READING')
	await input.press('Enter')
	await expect(dialog.getByText('tag READING is already selected.', { exact: true })).toBeVisible()
	await expect(
		dialog.getByRole('list', { name: 'tags', exact: true }).getByRole('listitem')
	).toHaveCount(1)
	await dialog.getByRole('button', { name: 'Remove Reading', exact: true }).focus()
	await page.keyboard.press('Enter')
	await expect(dialog.getByRole('button', { name: 'Remove Reading', exact: true })).toHaveCount(0)
	await expect(input).toBeFocused()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await page.reload()
	await expect(second.row).toBeVisible()
	await tags(page, second.row)
	await expect(dialog.getByRole('list', { name: 'tags', exact: true })).toHaveCount(0)
	await input.fill('Read')
	await expect(page.getByRole('option', { name: 'Reading', exact: true })).toBeVisible()
})

test('extracted article components keep single borders, compact controls and next/previous/heading focus', async ({
	page
}) => {
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	await supplied(page, 'https://example.com/component-first')
	await supplied(page, 'https://example.com/component-second')
	await supplied(page, 'https://example.com/component-third')
	const list = page
		.getByRole('region', { name: 'Saved articles', exact: true })
		.locator('ul.article-list')
	const rows = list.locator(':scope > li')
	await expect(rows).toHaveCount(3)
	const appearance = await list.evaluate((list) => {
		const items = [...list.querySelectorAll(':scope > li')]
		return {
			outer: getComputedStyle(list).borderTopWidth,
			bullets: getComputedStyle(list).listStyleType,
			items: items.map((item) => {
				const style = getComputedStyle(item)
				const favorite = [...item.querySelectorAll('button')].find(
					(button) => button.textContent?.trim() === 'Favorite'
				)
				return {
					top: style.borderTopWidth,
					bottom: style.borderBottomWidth,
					padding: style.paddingTop,
					favoriteShadow: favorite ? getComputedStyle(favorite).boxShadow : undefined
				}
			})
		}
	})
	expect(appearance.outer).toBe('1px')
	expect(appearance.bullets).toBe('none')
	expect(appearance.items.map((item) => item.top)).toEqual(['0px', '0px', '0px'])
	expect(appearance.items.map((item) => item.bottom)).toEqual(['1px', '1px', '0px'])
	expect(
		appearance.items.every((item) => item.padding === '12px' && item.favoriteShadow === 'none')
	).toBe(true)
	const middleId = await rows.nth(1).getAttribute('data-article-id')
	const firstId = await rows.first().getAttribute('data-article-id')
	const lastId = await rows.last().getAttribute('data-article-id')
	await rows.nth(1).getByRole('button', { name: 'Move to Trash', exact: true }).click()
	await expect(page.locator('[data-article-id="' + middleId + '"]')).toHaveCount(0)
	await expect(page.locator('[data-article-id="' + lastId + '"]')).toBeFocused()
	await page
		.locator('[data-article-id="' + lastId + '"]')
		.getByRole('button', { name: 'Move to Trash', exact: true })
		.click()
	await expect(page.locator('[data-article-id="' + firstId + '"]')).toBeFocused()
	await page
		.locator('[data-article-id="' + firstId + '"]')
		.getByRole('button', { name: 'Move to Trash', exact: true })
		.click()
	await expect(page.getByRole('heading', { name: 'Saved articles', exact: true })).toBeFocused()
	await expect(list).toHaveCount(0)
})

test('Add Link exposes invalid-source feedback without showing processing or success', async ({
	page
}) => {
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const dialog = await openAddLink(page)
	await dialog.getByLabel('Article URL', { exact: true }).fill('ftp://example.com/')
	await dialog.getByRole('button', { name: 'Add link', exact: true }).click()
	await expect(
		page.getByText('Enter a valid public HTTP or HTTPS URL.', { exact: true })
	).toBeVisible()
	await expect(page.locator('[data-article-id]')).toHaveCount(0)
	const next = await openAddLink(page)
	await next
		.getByLabel('Article URL', { exact: true })
		.fill('https://example.com/valid-after-error')
	await next.getByRole('button', { name: 'Add link', exact: true }).click()
	await expect(page.locator('[data-article-id]')).toHaveCount(1)
	await expect(
		page.getByText('Enter a valid public HTTP or HTTPS URL.', { exact: true })
	).toHaveCount(0)
	await expect(page.getByText('Saving on this device…', { exact: true })).toHaveCount(0)
})
test('DUI shares Unicode comparison for duplicate feedback and suggestion filtering', async ({
	page
}) => {
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const first = await supplied(page, 'https://example.com/canonical-first')
	const second = await supplied(page, 'https://example.com/canonical-second')
	await addTag(page, first.row, 'Straße')
	await addTag(page, first.row, 'Café')
	let dialog = await tags(page, first.row)
	const input = dialog.getByRole('combobox')
	await input.fill('STRASSE')
	await input.press('Enter')
	await expect(dialog.getByRole('status')).toHaveText('tag STRASSE is already selected.')
	await expect(
		dialog.getByRole('list', { name: 'tags', exact: true }).getByRole('listitem')
	).toHaveCount(2)
	await input.fill('Cafe\u0301')
	await input.press('Enter')
	await expect(dialog.getByRole('status')).toHaveText('tag Cafe\u0301 is already selected.')
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	dialog = await tags(page, second.row)
	await dialog.getByRole('combobox').fill('STRASSE')
	await expect(page.getByRole('option', { name: 'Straße', exact: true })).toBeVisible()
	await dialog.getByRole('combobox').press('ArrowDown')
	await dialog.getByRole('combobox').press('Enter')
	await expect(dialog.getByRole('button', { name: 'Remove Straße', exact: true })).toBeVisible()
})
