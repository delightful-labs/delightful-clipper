import { expect, type Page } from '@playwright/test'
export async function readingControls(page: Page) {
	await page.getByRole('button', { name: 'Reading controls', exact: true }).click()
	const dialog = page.getByRole('dialog', { name: 'Reading controls', exact: true })
	await expect(dialog).toBeVisible()
	return dialog
}
export async function visibleReadingParagraph(page: Page) {
	return page.getByRole('main').evaluate((main) => {
		const top = main.getBoundingClientRect().top,
			overlay = main.querySelector('[data-reader-overlay]')?.getBoundingClientRect().bottom ?? top
		return Array.from(main.querySelectorAll('article p'))
			.find(
				(p) =>
					p.getBoundingClientRect().bottom > Math.max(top, overlay) &&
					/Paragraph \d+/.test(p.textContent ?? '')
			)
			?.textContent?.match(/Paragraph (\d+)/)?.[1]
	})
}
