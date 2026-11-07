import { expect, type Page } from '@playwright/test'

async function openPopover(page: Page, label: string) {
	const panel = page.locator('[popover]').and(page.getByLabel(label, { exact: true }))
	if (!(await panel.isVisible()))
		await page.getByRole('button', { name: label, exact: true }).click()
	await expect(panel).toBeVisible()
	return panel
}

export const openLibrarySearch = (page: Page) => openPopover(page, 'Search articles')
export const openLibraryFilters = (page: Page) => openPopover(page, 'Filter articles')

export async function closeLibraryPopovers(page: Page) {
	const openPanel = page
		.locator('[popover]:popover-open')
		.and(page.getByLabel(/^(Search|Filter) articles$/))
	if (await openPanel.count()) await page.keyboard.press('Escape')
}
