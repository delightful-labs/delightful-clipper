import { expect, type Page } from '@playwright/test'

export async function openAddLink(page: Page) {
	await page.getByRole('button', { name: 'Add link', exact: true }).click()
	const dialog = page.getByRole('dialog', { name: 'Add link', exact: true })
	await expect(dialog).toBeVisible()
	return dialog
}
