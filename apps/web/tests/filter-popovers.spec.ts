import { expect, test } from '@playwright/test'
import { openLibraryFilters, openLibrarySearch } from './library-popovers.js'

for (const width of [1280, 390]) {
	test(`article search and filter popovers preserve selections and restore focus at ${width}px`, async ({
		page
	}) => {
		await page.setViewportSize({ width, height: 844 })
		await page.goto('/')
		const heading = page.getByRole('heading', { name: 'Saved articles', exact: true })
		const searchTrigger = page.getByRole('button', { name: 'Search articles', exact: true })
		const filterTrigger = page.getByRole('button', { name: 'Filter articles', exact: true })
		const field = page.getByRole('searchbox', { name: 'Search articles', exact: true })
		const statuses = page.getByRole('group', { name: 'Status', exact: true })
		await expect(heading).toBeVisible()
		await expect(field).not.toBeVisible()
		await expect(statuses).not.toBeVisible()
		await expect(searchTrigger).toHaveText('Search articles')
		await expect(searchTrigger.locator('svg')).toHaveAttribute('aria-hidden', 'true')
		await searchTrigger.focus()
		await page.keyboard.press('Enter')
		await expect(field).toBeFocused()
		await expect(field).toBeEnabled()
		await field.fill('retained query')
		const filterPanel = await openLibraryFilters(page)
		await expect(field).not.toBeVisible()
		await statuses.getByRole('radio', { name: 'Later', exact: true }).check()
		await page.getByRole('button', { name: 'Favorites', exact: true }).click()
		const bounds = await filterPanel.boundingBox()
		expect(bounds).not.toBeNull()
		expect(bounds!.x).toBeGreaterThanOrEqual(0)
		expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(width)
		expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
		await page.keyboard.press('Escape')
		await expect(filterTrigger).toBeFocused()
		await expect(statuses).not.toBeVisible()
		await openLibrarySearch(page)
		await expect(field).toHaveValue('retained query')
		await page.keyboard.press('Escape')
		await expect(searchTrigger).toBeFocused()
		await expect(field).not.toBeVisible()
		await openLibrarySearch(page)
		await expect(field).toHaveValue('retained query')
		await openLibraryFilters(page)
		await expect(statuses.getByRole('radio', { name: 'Later', exact: true })).toBeChecked()
		await expect(statuses.getByRole('radio', { name: 'Later', exact: true })).toBeFocused()
		await expect(page.getByRole('button', { name: 'Favorites', exact: true })).toHaveAttribute(
			'aria-pressed',
			'true'
		)
		await heading.click()
		await expect(statuses).not.toBeVisible()
	})
}
