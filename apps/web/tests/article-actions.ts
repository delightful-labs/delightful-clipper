import { expect, type Locator } from '@playwright/test'

export async function openArticleActions(row: Locator) {
	const panel = row.locator('[data-article-actions]')
	if (!(await panel.isVisible())) {
		if (await row.page().locator('[popover]:popover-open').count())
			await row.page().keyboard.press('Escape')
		await row.getByRole('button', { name: 'Article actions', exact: true }).click()
	}
	await expect(panel).toBeVisible()
	return panel
}
