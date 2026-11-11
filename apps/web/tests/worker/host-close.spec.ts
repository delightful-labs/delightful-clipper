import { test, expect } from '@playwright/test'

test('native Window closure excludes later writes and releases malformed transfers after control error', async ({
	page
}) => {
	await page.goto('/')
	const result = await page.evaluate(async () => {
		const path = '/tests/worker/host-close-driver.ts'
		return (await import(/* @vite-ignore */ path)).qualifyNativeHostClose()
	})
	expect(result).toEqual({
		matchingReceipt: true,
		closeCalls: 1,
		orphanReleases: 1,
		failures: 1,
		firstWriteObserved: true,
		writesAfterReceipt: 0
	})
})
