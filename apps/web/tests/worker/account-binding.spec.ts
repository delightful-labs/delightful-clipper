import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'

async function recovery(page: Page) {
	await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
	const dialog = page.getByRole('dialog')
	try {
		return await dialog.getByLabel('Recovery phrase', { exact: true }).inputValue()
	} finally {
		await dialog.getByRole('button', { name: 'Close', exact: true }).click()
		await expect(dialog).toBeHidden()
	}
}
async function seed(page: Page) {
	await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
	await page.evaluate(async () => {
		// The existing native SDK fixture owns its own Worker and clean close.
		const path = '/tests/worker/host-driver.ts'
		return (await import(/* @vite-ignore */ path)).qualifyHost()
	})
	const link = page.getByRole('link', { name: 'Worker proof', exact: true })
	await expect(link).toBeVisible()
	const href = await link.getAttribute('href')
	if (!href) throw new Error('Missing saved reader URL')
	return href
}
async function restore(page: Page, phrase: string) {
	await page.getByRole('textbox', { name: 'Recovery phrase', exact: true }).fill(phrase)
	await page.getByRole('button', { name: 'Restore account', exact: true }).click()
	await expect(
		page.getByRole('button', { name: 'Show recovery phrase', exact: true })
	).toBeVisible()
}
test('native restoration retires an attached A reader across A → B → A without exposing the other library', async ({
	page,
	browser
}) => {
	await page.goto('/')
	const origin = new URL(page.url()).origin
	const aReader = await seed(page),
		aPhrase = await recovery(page)
	const isolated = await browser.newContext()
	try {
		const b = await isolated.newPage()
		await b.goto(origin)
		const bReader = await seed(b),
			bPhrase = await recovery(b)
		expect(aReader === bReader).toBe(false)
		await page.getByRole('link', { name: 'Worker proof', exact: true }).click()
		await expect(page.getByRole('article')).toContainText('Saved in a worker.')
		const originalUrl = page.url()
		// The supported restore command changes the native Jazz session while this reader is attached.
		await restore(page, bPhrase)
		await expect(page.getByRole('article')).toHaveCount(0)
		expect((await recovery(page)) === bPhrase).toBe(true)
		expect(page.url()).toBe(originalUrl)
		await restore(page, aPhrase)
		await expect(page.getByRole('article')).toContainText('Saved in a worker.')
		expect(page.url()).toBe(originalUrl)
	} finally {
		await isolated.close()
	}
})
