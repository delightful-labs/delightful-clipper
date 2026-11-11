import { test, expect } from '@playwright/test'

for (const mode of ['image', 'extract'] as const)
	for (const fault of ['none', 'post', 'cancel'] as const) {
		test(`shared ${mode} job qualifies native ${fault} completion and cleanup`, async ({
			page
		}) => {
			await page.goto('/')
			await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
			const result = await page.evaluate(
				async ({ mode, fault }) => {
					const path = '/tests/worker/browser-jobs-driver.ts'
					return (await import(/* @vite-ignore */ path)).qualifyBrowserJob(mode, fault)
				},
				{ mode, fault }
			)
			expect(result).toMatchObject({
				outcome: fault === 'none' ? 'replied' : fault === 'post' ? 'failed' : 'cancelled',
				posts: 1,
				terminations: 1,
				handlersRemoved: true
			})
			if (fault === 'post') expect(result).toMatchObject({ reason: 'post' })
			if (fault === 'none' && mode === 'image')
				expect(result).toMatchObject({
					image: { width: 3, height: 2, mediaType: 'image/png', bytes: expect.any(Number) }
				})
			if (fault === 'none' && mode === 'extract')
				expect(result).toMatchObject({
					content: { title: 'Worker extraction fixture', sameSource: true, text: true }
				})
		})
	}
