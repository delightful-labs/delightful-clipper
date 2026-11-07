import { expect, type Page } from '@playwright/test'
import { closeLibraryPopovers } from './library-popovers.js'

export async function openAddLink(page: Page) {
	await closeLibraryPopovers(page)
	await page.getByRole('button', { name: 'Add link', exact: true }).click()
	const dialog = page.getByRole('dialog', { name: 'Add link', exact: true })
	await expect(dialog).toBeVisible()
	return dialog
}
