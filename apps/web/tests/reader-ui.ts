import { expect, type Page } from '@playwright/test'

async function settledReaderLayout(page: Page) {
	await page.locator('.reader-workspace').evaluate(async (reader) => {
		await Promise.all(
			reader.getAnimations({ subtree: true }).map((animation) => animation.finished)
		)
		await new Promise<void>((resolve) => {
			requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
		})
	})
}

export async function readingControls(page: Page) {
	const toggle = page.getByRole('button', { name: 'Reading controls', exact: true })
	if ((await toggle.getAttribute('aria-expanded')) === 'false') await toggle.click()
	const drawer = page.getByRole('complementary', { name: 'Reading controls', exact: true })
	await expect(drawer).toHaveAttribute('data-open', 'true')
	await settledReaderLayout(page)
	return drawer
}
export async function closeReadingControls(page: Page) {
	const toggle = page.getByRole('button', { name: 'Reading controls', exact: true })
	if ((await toggle.getAttribute('aria-expanded')) === 'true') await toggle.click()
	await settledReaderLayout(page)
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
