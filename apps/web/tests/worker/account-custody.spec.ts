import { test, expect } from '@playwright/test'

for (const forced of [false, true]) {
	test(`account write custody survives lost reply and late closure${forced ? ' after forced owner stop' : ''}`, async ({
		page
	}) => {
		await page.goto('/')
		const result = await page.evaluate(async (forced) => {
			const path = '/tests/worker/account-custody-driver.ts'
			return (await import(/* @vite-ignore */ path)).qualifyAccountCustody(forced)
		}, forced)
		expect(result).toEqual({
			cleanOwnerClose: !forced,
			firstTransforms: 1,
			secondTransforms: 0,
			writeOutcome: 'unknown',
			workerOnly: true,
			matchingScope: true,
			heldBeforeReceipt: 1,
			writes: 1,
			persisted: 'persisted',
			probeEntered: true
		})
	})
}
