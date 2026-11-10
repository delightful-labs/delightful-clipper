import { test, expect } from '@playwright/test'

test('Worker broker adapter preserves native generation storage and accepted SharedWorker port ownership', async ({
	page
}) => {
	await page.goto('/')
	const result = await page.evaluate(async () => {
		const path = '/tests/worker/broker-driver.ts'
		return (await import(/* @vite-ignore */ path)).qualifyBroker(false)
	})
	expect(result).toEqual({
		before: '4',
		after: '5',
		echo: 'SDK retains accepted port after host closure',
		matchingReceipt: true,
		windowPresent: false,
		opens: 1,
		writes: 1
	})
})

test('a late actual SharedWorker port is discarded after timeout and only matching late closure finishes drain', async ({
	page
}) => {
	await page.goto('/')
	const result = await page.evaluate(async () => {
		const path = '/tests/worker/broker-driver.ts'
		return (await import(/* @vite-ignore */ path)).qualifyBroker(true)
	})
	expect(result).toEqual({
		outcome: 'unknown',
		discarded: 1,
		overdue: 1,
		matchingReceipt: true,
		windowPresent: false,
		opens: 1,
		writes: 0,
		wrongReceiptIgnored: true
	})
})
