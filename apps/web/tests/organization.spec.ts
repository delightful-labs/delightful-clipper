import { openAddLink } from './add-link.js'
import { test, expect, chromium } from '@playwright/test'
import type { Page } from '@playwright/test'
import { startLocalJazzServer } from 'jazz-tools/testing'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from '../src/lib/backend/jazz/schema.js'
import permissions from '../src/lib/backend/jazz/permissions.js'
let authority: Awaited<ReturnType<typeof startLocalJazzServer>>
let dataDir: string
const base = 'http://127.0.0.1:5180'
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
	dataDir = await mkdtemp(join(tmpdir(), 'clipper-organization-'))
	authority = await startAuthority()
})
test.afterAll(async () => {
	await authority?.stop()
	await rm(dataDir, { recursive: true, force: true })
})
async function supplied(page: Page, suffix: string) {
	const result = await page.evaluate(async (url) => {
		const path = '/tests/article-driver.ts'
		return (await import(/* @vite-ignore */ path)).supplied(url)
	}, `https://example.com/${suffix}`)
	expect(result.kind).toBe('saved')
	const row = page.locator(`[data-article-id="${result.id}"]`)
	await expect(row).toBeVisible()
	return row
}
test('changes all statuses, keeps favorites independent, combines filters, and preserves reader and duplicate capture', async ({
	page
}) => {
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const first = await supplied(page, 'organize-first'),
		second = await supplied(page, 'organize-second')
	await expect(first.getByLabel('Status', { exact: true })).toHaveValue('inbox')
	await first.getByRole('button', { name: 'Favorite', exact: true }).click()
	await expect(first.getByRole('button', { name: 'Remove favorite', exact: true })).toBeEnabled()
	for (const status of ['later', 'archive', 'inbox']) {
		await first.getByLabel('Status', { exact: true }).selectOption(status)
		await expect(first.getByLabel('Status', { exact: true })).toBeEnabled()
		await expect(
			first.getByRole('button', { name: 'Remove favorite', exact: true })
		).toHaveAttribute('aria-pressed', 'true')
	}
	await first.getByLabel('Status', { exact: true }).selectOption('later')
	await expect(first.getByLabel('Status', { exact: true })).toBeEnabled()
	await page.getByRole('radio', { name: 'Later', exact: true }).check()
	await expect(second).toHaveCount(0)
	await page.getByRole('button', { name: 'Favorites', exact: true }).click()
	await expect(first).toBeVisible()
	await first.getByRole('button', { name: 'Remove favorite', exact: true }).click()
	await expect(first).toHaveCount(0)
	await expect(page.getByText('No articles match this view.', { exact: true })).toBeVisible()
	await page.getByRole('button', { name: 'Favorites', exact: true }).click()
	await expect(first.getByLabel('Status', { exact: true })).toHaveValue('later')
	await expect(first.getByRole('button', { name: 'Favorite', exact: true })).toBeEnabled()
	// A duplicate keeps the snapshot, original status and independent favorite value.
	const repeat = await page.evaluate(async () => {
		const path = '/tests/article-driver.ts'
		return (await import(/* @vite-ignore */ path)).supplied('https://example.com/organize-first')
	})
	expect(repeat.kind).toBe('duplicate')
	await expect(first.getByLabel('Status', { exact: true })).toHaveValue('later')
	await first.getByRole('link', { name: 'Supplied clip', exact: true }).click()
	await expect(page.getByRole('article')).toContainText('Content supplied by a browser clip.')
	await page.getByRole('link', { name: 'Open library', exact: true }).click()
	await expect(first.getByLabel('Status', { exact: true })).toHaveValue('later')
})
test('synchronizes independent desired values in both directions between restored clients', async ({
	page,
	browser
}) => {
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const row = await supplied(page, 'organize-sync')
	const id = await row.getAttribute('data-article-id')
	await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
	const dialog = page.getByRole('dialog')
	const phrase = await dialog.getByLabel('Recovery phrase', { exact: true }).inputValue()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	const independent = await browser.newContext()
	try {
		const restored = await independent.newPage()
		await restored.goto(base)
		await restored.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await restored.getByRole('button', { name: 'Restore account', exact: true }).click()
		const remote = restored.locator(`[data-article-id="${id}"]`)
		await expect(remote).toBeVisible({ timeout: 30000 })
		await row.getByLabel('Status', { exact: true }).selectOption('archive')
		await expect(remote.getByLabel('Status', { exact: true })).toHaveValue('archive', {
			timeout: 30000
		})
		await remote.getByRole('button', { name: 'Favorite', exact: true }).click()
		await expect(row.getByRole('button', { name: 'Remove favorite', exact: true })).toBeEnabled({
			timeout: 30000
		})
		await row.getByLabel('Status', { exact: true }).selectOption('later')
		await expect(remote.getByLabel('Status', { exact: true })).toHaveValue('later', {
			timeout: 30000
		})
		await expect(
			remote.getByRole('button', { name: 'Remove favorite', exact: true })
		).toHaveAttribute('aria-pressed', 'true')
	} finally {
		await independent.close()
	}
})
test('persists offline edits across complete browser restart and synchronizes on reconnect', async ({
	browser
}) => {
	const profile = await mkdtemp(join(tmpdir(), 'clipper-organization-restart-'))
	let context = await chromium.launchPersistentContext(profile, { headless: true })
	const independent = await browser.newContext()
	try {
		const page = await context.newPage()
		await page.goto(base)
		await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
		const row = await supplied(page, 'organize-restart')
		const id = await row.getAttribute('data-article-id')
		await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
		const phrase = await page
			.getByRole('dialog')
			.getByLabel('Recovery phrase', { exact: true })
			.inputValue()
		await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
		const restored = await independent.newPage()
		await restored.goto(base)
		await restored.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await restored.getByRole('button', { name: 'Restore account', exact: true }).click()
		const remote = restored.locator(`[data-article-id="${id}"]`)
		await expect(remote).toBeVisible({ timeout: 30000 })
		await authority.stop()
		await row.getByLabel('Status', { exact: true }).selectOption('archive')
		await expect(row.getByLabel('Status', { exact: true })).toBeEnabled()
		await row.getByRole('button', { name: 'Favorite', exact: true }).click()
		await expect(row.getByRole('button', { name: 'Remove favorite', exact: true })).toBeEnabled()
		await context.close()
		context = await chromium.launchPersistentContext(profile, { headless: true })
		const reopened = await context.newPage()
		await reopened.goto(base)
		const persisted = reopened.locator(`[data-article-id="${id}"]`)
		await expect(persisted.getByLabel('Status', { exact: true })).toHaveValue('archive')
		await expect(
			persisted.getByRole('button', { name: 'Remove favorite', exact: true })
		).toHaveAttribute('aria-pressed', 'true')
		await persisted.getByLabel('Status', { exact: true }).selectOption('later')
		await expect(persisted.getByLabel('Status', { exact: true })).toBeEnabled()
		authority = await startAuthority()
		await reopened.reload()
		await restored.reload()
		await expect(remote.getByLabel('Status', { exact: true })).toHaveValue('later', {
			timeout: 30000
		})
		await expect(
			remote.getByRole('button', { name: 'Remove favorite', exact: true })
		).toHaveAttribute('aria-pressed', 'true')
	} finally {
		await independent.close()
		await context.close()
		await rm(profile, { recursive: true, force: true })
		await authority.stop()
		authority = await startAuthority()
	}
})
test('organizes a link-only article and retains its values when supplied content completes it', async ({
	page
}) => {
	await page.route('**/api/capture/resolve', (route) =>
		route.fulfill({ status: 503, json: { code: 'gatewayUnavailable' } })
	)
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const url = 'https://example.com/organize-pending'
	await openAddLink(page)
	await page.getByLabel('Article URL', { exact: true }).fill(url)
	await page
		.getByRole('dialog', { name: 'Add link', exact: true })
		.getByRole('button', { name: 'Add link', exact: true })
		.click()
	const row = page
		.locator('[data-article-id]')
		.filter({ has: page.getByRole('link', { name: 'Open original', exact: true }) })
	await expect(row).toBeVisible()
	await row.getByLabel('Status', { exact: true }).selectOption('later')
	await expect(row.getByLabel('Status', { exact: true })).toBeEnabled()
	await row.getByRole('button', { name: 'Favorite', exact: true }).click()
	await expect(row.getByRole('button', { name: 'Remove favorite', exact: true })).toBeEnabled()
	const id = await row.getAttribute('data-article-id')
	await page.evaluate(async (url) => {
		const path = '/tests/article-driver.ts'
		return (await import(/* @vite-ignore */ path)).supplied(url)
	}, url)
	const completed = page.locator(`[data-article-id="${id}"]`)
	await expect(completed.getByRole('link', { name: 'Supplied clip', exact: true })).toBeVisible()
	await expect(completed.getByLabel('Status', { exact: true })).toHaveValue('later')
	await expect(
		completed.getByRole('button', { name: 'Remove favorite', exact: true })
	).toHaveAttribute('aria-pressed', 'true')
})

test('native status radios support keyboard navigation and mobile wrapping while Favorites stays independent', async ({
	page
}) => {
	await page.setViewportSize({ width: 390, height: 844 })
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const inbox = await supplied(page, 'radio-inbox')
	const archived = await supplied(page, 'radio-archive')
	await archived.getByLabel('Status', { exact: true }).selectOption('archive')
	await expect(archived.getByLabel('Status', { exact: true })).toBeEnabled()
	await inbox.getByRole('button', { name: 'Favorite', exact: true }).click()
	const favorites = page.getByRole('button', { name: 'Favorites', exact: true })
	await favorites.click()
	const group = page.getByRole('group', { name: 'Status', exact: true })
	await expect(group.getByRole('radio')).toHaveCount(4)
	await expect(group.getByRole('radio', { name: 'All', exact: true })).toBeChecked()
	await expect(inbox).toBeVisible()
	await expect(archived).toHaveCount(0)
	await group.getByRole('radio', { name: 'All', exact: true }).focus()
	for (const name of ['Inbox', 'Later', 'Archive', 'All']) {
		await page.keyboard.press('ArrowRight')
		await expect(group.getByRole('radio', { name, exact: true })).toBeChecked()
		await expect(group.getByRole('radio', { name, exact: true })).toBeFocused()
		await expect(group.locator('input:checked')).toHaveCount(1)
		await expect(favorites).toHaveAttribute('aria-pressed', 'true')
	}
	await page.keyboard.press('ArrowLeft')
	await expect(group.getByRole('radio', { name: 'Archive', exact: true })).toBeChecked()
	await expect(inbox).toHaveCount(0)
	await expect(archived).toHaveCount(0)
	await favorites.click()
	await expect(group.getByRole('radio', { name: 'Archive', exact: true })).toBeChecked()
	await expect(archived).toBeVisible()
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
