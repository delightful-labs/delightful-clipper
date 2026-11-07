import {
	readingControls as controls,
	visibleReadingParagraph as visibleParagraph
} from './reader-ui.js'
import { test, expect, chromium } from '@playwright/test'
import type { projectReaderState } from '../src/lib/reader/schema.js'
import type { Page } from '@playwright/test'
import { startLocalJazzServer } from 'jazz-tools/testing'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from '../src/lib/backend/jazz/schema.js'
import permissions from '../src/lib/backend/jazz/permissions.js'
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
	directory = await mkdtemp(join(tmpdir(), 'clipper-reader-browser-'))
	authority = await startLocalJazzServer(options())
})
test.afterAll(async () => {
	await authority.stop()
	await rm(directory, { recursive: true, force: true })
})
async function seed(page: Page, url = 'https://example.com/reader-experience') {
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const id = await page.evaluate(async (url) => {
		const path = '/tests/reader-driver.ts'
		return (await import(/* @vite-ignore */ path)).seedReader(url)
	}, url)
	await page.getByRole('link', { name: 'Reader experience fixture', exact: true }).click()
	await expect(page).toHaveURL(new RegExp('/articles/' + id))
	await expect(
		page
			.getByRole('article')
			.getByRole('heading', { name: 'Reader experience fixture', exact: true })
	).toBeVisible()
	return id
}
async function state(page: Page): Promise<ReturnType<typeof projectReaderState>> {
	return page.evaluate(async () => {
		const path = '/tests/reader-driver.ts'
		return (await import(/* @vite-ignore */ path)).readingState()
	})
}
async function readMiddle(page: Page) {
	await page.getByRole('main').hover()
	await page.mouse.wheel(0, 10000)
	await expect
		.poll(async () => Math.max(0, ...Object.values((await state(page)).progress)))
		.toBeGreaterThan(0.2)
	return visibleParagraph(page)
}
async function phrase(page: Page) {
	await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
	const dialog = page.getByRole('dialog')
	const value = await dialog.getByLabel('Recovery phrase', { exact: true }).inputValue()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	return value
}
test('uses shared reader controls, keyboard contents/footnotes, persistent focus-mode exit and explicit Archive', async ({
	page
}) => {
	await seed(page)
	await page.getByText('Table of contents', { exact: true }).click()
	const contents = page.getByRole('navigation', { name: 'Table of contents', exact: true })
	await contents.getByRole('link', { name: 'Middle chapter', exact: true }).focus()
	await page.keyboard.press('Enter')
	await expect(page.getByRole('heading', { name: 'Middle chapter', exact: true })).toBeInViewport()
	await contents.getByRole('link', { name: 'Beginning', exact: true }).click()
	const citation = page.getByRole('article').getByRole('link', { name: 'Citation', exact: true })
	await citation.focus()
	await page.keyboard.press('Enter')
	const note = page.getByRole('note', { name: 'note', exact: true })
	await expect(note).toContainText('A saved reader footnote.')
	await page.keyboard.press('Escape')
	await expect(note).not.toBeVisible()
	await expect(citation).toBeFocused()
	await citation.click()
	await note.getByRole('link', { name: 'Open note', exact: true }).click()
	await expect(page.getByRole('article').getByRole('listitem')).toBeFocused()
	await page.getByRole('button', { name: 'Distraction-free reading', exact: true }).click()
	await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
	await expect(page.getByRole('button', { name: 'Reading controls', exact: true })).toHaveCount(0)
	const show = page.getByRole('button', { name: 'Show controls', exact: true })
	await expect(show).toBeFocused()
	await show.press('Enter')
	await expect.poll(() => page.evaluate(() => document.fullscreenElement)).toBe(null)
	await expect(
		page.getByRole('button', { name: 'Distraction-free reading', exact: true })
	).toBeFocused()
	await page.getByRole('button', { name: 'Distraction-free reading', exact: true }).click()
	await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
	await page.evaluate(() => document.exitFullscreen())
	await expect(page.getByRole('button', { name: 'Reading controls', exact: true })).toBeVisible()
	const path = new URL(page.url()).pathname
	await page.getByRole('button', { name: 'Archive', exact: true }).click()
	await expect(page.getByRole('button', { name: 'Archive', exact: true })).toHaveCount(0)
	await expect(page).toHaveURL(new RegExp(path))
	await page.getByRole('link', { name: 'Open library', exact: true }).click()
	await expect(page.locator('[data-article-id]').getByLabel('Status', { exact: true })).toHaveValue(
		'archive'
	)
})
test('keeps a text anchor through typography, viewport resizing, navigation and reload while progress remains furthest reached', async ({
	page
}) => {
	const id = await seed(page)
	const paragraph = await readMiddle(page)
	await page.getByRole('button', { name: 'Distraction-free reading', exact: true }).click()
	await expect.poll(() => page.evaluate(() => document.fullscreenElement !== null)).toBe(true)
	await expect.poll(() => visibleParagraph(page)).toBe(paragraph)
	await page.getByRole('button', { name: 'Show controls', exact: true }).click()
	await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true)
	await expect.poll(() => visibleParagraph(page)).toBe(paragraph)
	const dialog = await controls(page)
	await dialog.getByLabel('Font family', { exact: true }).selectOption('sans')
	await dialog.getByRole('slider', { name: 'Font size', exact: true }).press('End')
	await dialog.getByRole('slider', { name: 'Line spacing', exact: true }).press('End')
	await dialog.getByRole('slider', { name: 'Reading width', exact: true }).press('Home')
	await dialog.getByRole('radio', { name: 'Dark', exact: true }).check()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	await expect.poll(() => visibleParagraph(page)).toBe(paragraph)
	await page.setViewportSize({ width: 800, height: 700 })
	await expect.poll(() => visibleParagraph(page)).toBe(paragraph)
	await expect
		.poll(async () => (await state(page)).preferences)
		.toMatchObject({ theme: 'dark', font: 'sans', size: 32, spacing: 2, width: 40 })
	const furthest = Math.max(...Object.values((await state(page)).progress))
	await page.reload()
	await expect.poll(() => visibleParagraph(page)).toBe(paragraph)
	await page.getByRole('main').hover()
	await page.mouse.wheel(0, -4000)
	await expect
		.poll(async () => Number(await visibleParagraph(page)))
		.toBeLessThan(Number(paragraph))
	await page.getByRole('link', { name: 'Open library', exact: true }).click()
	const row = page.locator(`[data-article-id="${id}"]`)
	await expect(row.getByRole('progressbar')).toHaveAttribute('value', String(furthest))
	await row.getByRole('link').click()
	await expect
		.poll(async () => Number(await visibleParagraph(page)))
		.toBeLessThan(Number(paragraph))
})
test('synchronizes independent settings and latest positions without scrolling an already open remote reader', async ({
	page,
	browser
}) => {
	const id = await seed(page),
		recovery = await phrase(page)
	const context = await browser.newContext()
	try {
		const other = await context.newPage()
		await other.goto('/')
		await other.getByLabel('Recovery phrase', { exact: true }).fill(recovery)
		await other.getByRole('button', { name: 'Restore account', exact: true }).click()
		await other.locator(`[data-article-id="${id}"]`).getByRole('link').click()
		const before = await other.getByRole('main').evaluate((node) => node.scrollTop)
		await readMiddle(page)
		await expect.poll(async () => Object.keys((await state(other)).positions).length).toBe(1)
		expect(await other.getByRole('main').evaluate((node) => node.scrollTop)).toBe(before)
		const first = await controls(page)
		await first.getByRole('radio', { name: 'Dark', exact: true }).check()
		await first.getByRole('button', { name: 'Close', exact: true }).click()
		const second = await controls(other)
		await expect(second.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked()
		await second.getByLabel('Font family', { exact: true }).selectOption('sans')
		await second.getByRole('button', { name: 'Close', exact: true }).click()
		await expect.poll(async () => (await state(page)).preferences.font).toBe('sans')
		await other.reload()
		await expect.poll(async () => Number(await visibleParagraph(other))).toBeGreaterThan(1)
	} finally {
		await context.close()
	}
})
test('retains offline reading settings and location through a complete browser restart and then synchronizes', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'clipper-reader-restart-'))
	let context = await chromium.launchPersistentContext(directory, { headless: true }),
		stopped = false
	try {
		const page = await context.newPage()
		const id = await seed(page)
		await authority.stop()
		stopped = true
		const dialog = await controls(page)
		await dialog.getByRole('radio', { name: 'Dark', exact: true }).check()
		await dialog.getByRole('button', { name: 'Close', exact: true }).click()
		const paragraph = await readMiddle(page)
		await page.getByRole('link', { name: 'Open library', exact: true }).click()
		await expect(page.locator(`[data-article-id="${id}"]`).getByRole('progressbar')).toBeVisible()
		await context.close()
		context = await chromium.launchPersistentContext(directory, { headless: true })
		const reopened = await context.newPage()
		await reopened.goto('http://127.0.0.1:5180/articles/' + id)
		await expect.poll(() => visibleParagraph(reopened)).toBe(paragraph)
		const again = await controls(reopened)
		await expect(again.getByRole('radio', { name: 'Dark', exact: true })).toBeChecked()
		await again.getByRole('button', { name: 'Close', exact: true }).click()
		authority = await startLocalJazzServer(options())
		stopped = false
		await expect(
			reopened.getByRole('button', { name: 'Show recovery phrase', exact: true })
		).toBeVisible()
	} finally {
		await context.close()
		if (stopped) authority = await startLocalJazzServer(options())
		await rm(directory, { recursive: true, force: true })
	}
})
test('shows live progress before a debounced save and keeps the furthest progress while scrolling back', async ({
	page
}) => {
	await seed(page)
	await page.clock.install()
	const main = page.getByRole('main')
	await main.hover()
	await page.mouse.wheel(0, 6000)
	await expect.poll(() => main.evaluate((node) => node.scrollTop)).toBeGreaterThan(2000)
	await page.clock.runFor(100)
	const progress = Number(await page.getByRole('progressbar').getAttribute('value'))
	expect(progress).toBeGreaterThan(0)
	expect((await state(page)).progress).toEqual({})
	const paragraph = Number(await visibleParagraph(page))
	await page.mouse.wheel(0, -3000)
	await expect.poll(() => visibleParagraph(page)).not.toBe(String(paragraph))
	await page.clock.runFor(100)
	expect(Number(await visibleParagraph(page))).toBeLessThan(paragraph)
	await expect(page.getByRole('progressbar')).toHaveAttribute('value', String(progress))
	await page.clock.runFor(1100)
	await expect
		.poll(async () => Math.max(...Object.values((await state(page)).progress)))
		.toBe(progress)
})
test('updates progress for a short article when a reading gesture cannot scroll it', async ({
	page
}) => {
	await page.setViewportSize({ width: 1600, height: 1400 })
	await page.goto('/')
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	const id = await page.evaluate(async () => {
		const path = '/tests/reader-driver.ts'
		return (await import(/* @vite-ignore */ path)).seedReader('https://example.com/short-reader', 1)
	})
	await page.goto('/articles/' + id)
	await expect(page.getByRole('article')).toBeVisible()
	const main = page.getByRole('main')
	expect(await main.evaluate((node) => node.scrollHeight <= node.clientHeight)).toBe(true)
	await main.hover()
	await page.mouse.wheel(0, 200)
	await expect.poll(async () => Math.max(0, ...Object.values((await state(page)).progress))).toBe(1)
	await expect(page.getByRole('progressbar')).toHaveAttribute('value', '1')
})
