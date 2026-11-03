import { test, expect } from '@playwright/test'
import { startLocalJazzServer } from 'jazz-tools/testing'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { app } from '../src/lib/backend/jazz/schema.js'
import permissions from '../src/lib/backend/jazz/permissions.js'

let authority: Awaited<ReturnType<typeof startLocalJazzServer>>
let dataDir: string
const startAuthority = () =>
	startLocalJazzServer({
		appId: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
		host: '127.0.0.1',
		port: 5181,
		dataDir,
		schema: app,
		permissions
	})
test.beforeAll(async () => {
	dataDir = await mkdtemp(join(tmpdir(), 'clipper-browser-'))
	authority = await startAuthority()
})
test.afterAll(async () => {
	await authority?.stop()
	if (dataDir) await rm(dataDir, { recursive: true, force: true })
})

test('creates, reloads and restores the same account into an independent browser context', async ({
	page,
	browser
}) => {
	await page.goto('/')
	await page.getByRole('button', { name: 'Create account', exact: true }).click()
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	await page.reload()
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
	const dialog = page.getByRole('dialog')
	await expect(dialog).toBeVisible()
	const phrase = await dialog.getByLabel('Recovery phrase', { exact: true }).inputValue()
	await dialog.getByRole('button', { name: 'Close', exact: true }).click()
	const second = await browser.newContext()
	try {
		const restored = await second.newPage()
		await restored.goto('http://127.0.0.1:5180')
		await restored.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await restored.getByRole('button', { name: 'Restore account', exact: true }).click()
		await expect(restored.getByText('Private library synced.', { exact: true })).toBeVisible()
		// Stop the real authority: the SDK transport can live in a SharedWorker.
		await authority.stop()
		await restored.reload()
		await expect(
			restored.getByText('Library saved on this device. Sync pending.', { exact: true })
		).toBeVisible()
		authority = await startAuthority()
		await restored.reload()
		await expect(restored.getByText('Private library synced.', { exact: true })).toBeVisible()
	} finally {
		await second.close()
	}
})

test('invalid restoration does not create an account', async ({ page }) => {
	await page.goto('/')
	await page.getByLabel('Recovery phrase', { exact: true }).fill('not a valid recovery phrase')
	await page.getByRole('button', { name: 'Restore account', exact: true }).click()
	await expect(
		page.getByText('That recovery phrase is invalid. Check it and try again.', { exact: true })
	).toBeVisible()
	await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeVisible()
	await expect(page.getByLabel('Recovery phrase', { exact: true })).toHaveValue('')
})
