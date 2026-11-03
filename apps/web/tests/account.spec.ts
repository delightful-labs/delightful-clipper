import { test, expect, chromium } from '@playwright/test'
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
		await restored.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
		const recoveredPhrase = await restored
			.getByRole('dialog')
			.getByLabel('Recovery phrase', { exact: true })
			.inputValue()
		await restored.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
		// Assert a boolean after closing the dialog so failures cannot print credentials.
		expect(recoveredPhrase === phrase).toBe(true)
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

test('retains the account and library after closing every page and browser process with the authority offline', async () => {
	const profile = await mkdtemp(join(tmpdir(), 'clipper-cold-profile-'))
	let context = await chromium.launchPersistentContext(profile, { headless: true })
	try {
		const page = await context.newPage()
		await page.goto('http://127.0.0.1:5180')
		await page.getByRole('button', { name: 'Create account', exact: true }).click()
		await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
		await authority.stop()
		await context.close()
		// Persistent-context close exits its browser process, including its workers.
		context = await chromium.launchPersistentContext(profile, { headless: true })
		const reopened = await context.newPage()
		await reopened.goto('http://127.0.0.1:5180')
		await expect(
			reopened.getByText('Library saved on this device. Sync pending.', { exact: true })
		).toBeVisible()
		authority = await startAuthority()
		await reopened.reload()
		await expect(reopened.getByText('Private library synced.', { exact: true })).toBeVisible()
	} finally {
		await context.close()
		await rm(profile, { recursive: true, force: true })
	}
})

test('saves new content offline, restarts the browser, and syncs to a restored profile', async ({
	browser
}) => {
	const profile = await mkdtemp(join(tmpdir(), 'clipper-content-profile-'))
	let context = await chromium.launchPersistentContext(profile, { headless: true })
	const independent = await browser.newContext()
	const operationId = crypto.randomUUID()
	const expected = { text: 'Exact offline text café 🦊', bytes: [0, 1, 2, 255] }
	try {
		const page = await context.newPage()
		await page.goto('http://127.0.0.1:5180')
		await page.getByRole('button', { name: 'Create account', exact: true }).click()
		await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
		await page.getByRole('button', { name: 'Show recovery phrase', exact: true }).click()
		const phrase = await page
			.getByRole('dialog')
			.getByLabel('Recovery phrase', { exact: true })
			.inputValue()
		await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click()
		const restored = await independent.newPage()
		await restored.goto('http://127.0.0.1:5180')
		await restored.getByLabel('Recovery phrase', { exact: true }).fill(phrase)
		await restored.getByRole('button', { name: 'Restore account', exact: true }).click()
		await expect(restored.getByText('Private library synced.', { exact: true })).toBeVisible()
		await authority.stop()
		expect(
			await page.evaluate(async (id) => {
				const path = '/tests/storage-driver.ts'
				return (await import(/* @vite-ignore */ path)).save(id)
			}, operationId)
		).toBe('saved')
		await context.close()
		context = await chromium.launchPersistentContext(profile, { headless: true })
		const reopened = await context.newPage()
		await reopened.goto('http://127.0.0.1:5180')
		await expect(
			reopened.getByText('Library saved on this device. Sync pending.', { exact: true })
		).toBeVisible()
		expect(
			await reopened.evaluate(async (id) => {
				const path = '/tests/storage-driver.ts'
				return (await import(/* @vite-ignore */ path)).read(id)
			}, operationId)
		).toEqual(expected)
		authority = await startAuthority()
		await reopened.reload()
		await restored.reload()
		await expect(restored.getByText('Private library synced.', { exact: true })).toBeVisible()
		await expect
			.poll(
				() =>
					restored.evaluate(async (id) => {
						const path = '/tests/storage-driver.ts'
						return (await import(/* @vite-ignore */ path)).read(id)
					}, operationId),
				{ timeout: 30000 }
			)
			.toEqual(expected)
	} finally {
		await independent.close()
		await context.close()
		await rm(profile, { recursive: true, force: true })
	}
})

test('authenticates capture requests with the existing account and rejects missing or forged bearers', async ({
	page,
	request
}) => {
	await page.goto('/')
	await page.getByRole('button', { name: 'Create account', exact: true }).click()
	await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
	expect((await request.post('/api/capture/resolve')).status()).toBe(401)
	expect(
		(
			await request.post('/api/capture/resolve', { headers: { Authorization: 'Bearer forged' } })
		).status()
	).toBe(401)
	// The capture implementation remains a later batch; passing authentication
	// reaches routing (404), while the same request without its managed bearer is 401.
	expect(
		await page.evaluate(async () => {
			const path = '/tests/storage-driver.ts'
			const { requestCapture } = await import(/* @vite-ignore */ path)
			return (
				await requestCapture('resolve', {
					protocolVersion: 1,
					operationId: crypto.randomUUID(),
					url: 'https://example.com'
				})
			).status
		})
	).toBe(404)
})
