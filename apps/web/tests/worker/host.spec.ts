import { z } from 'zod'
import { test, expect } from '@playwright/test'
import { startLocalJazzServer } from 'jazz-tools/testing'
import { app } from '../../src/lib/backend/jazz/schema.js'
import permissions from '../../src/lib/backend/jazz/permissions.js'
let authority: Awaited<ReturnType<typeof startLocalJazzServer>>
test.beforeAll(async () => {
	authority = await startLocalJazzServer({
		appId: '2db98ae3-fcf1-41e8-b7d3-9818496bde60',
		host: '127.0.0.1',
		port: 5481,
		inMemory: true,
		schema: app,
		permissions
	})
})
test.afterAll(async () => {
	await authority?.stop()
})
test('dedicated worker reuses the existing identity and persistent library without a Window shim', async ({
	page
}) => {
	await page.goto('/')
	await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
	const result = await page.evaluate(async () => {
		const path = '/tests/worker/host-driver.ts'
		return (await import(/* @vite-ignore */ path)).qualifyHost()
	})
	expect(result).toMatchObject({
		type: 'READY',
		sameAccount: true,
		existing: true,
		written: true,
		domainSaved: true,
		windowPresent: false,
		sharedWorker: 'undefined'
	})
	await page.reload()
	await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
	await expect(page.getByRole('link', { name: 'Worker proof', exact: true })).toBeVisible()
	const { operationId } = z.object({ operationId: z.string().uuid() }).parse(result)
	await page.evaluate(async () => {
		const path = '/tests/worker/host-driver.ts'
		await import(/* @vite-ignore */ path)
	})
	await page.context().setOffline(true)
	const retained = await page.evaluate(async (id) => {
		const path = '/tests/worker/host-driver.ts'
		return (await import(/* @vite-ignore */ path)).workerIntentExists(id)
	}, operationId)
	expect(retained).toBe(true)
	await page.context().setOffline(false)
})

test('application worker runs DLF readiness and domain library, then drains before closing', async ({
	page
}) => {
	await page.goto('/')
	await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
	const result = await page.evaluate(async () => {
		const path = '/tests/worker/host-driver.ts'
		return (await import(/* @vite-ignore */ path)).qualifyApplicationHost()
	})
	expect(result).toMatchObject({
		type: 'VIEW',
		library: { rows: [], total: 0 },
		worker: { windowPresent: false }
	})
})

test('application worker waits for acquisition during immediate shutdown', async ({ page }) => {
	await page.goto('/')
	await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
	const result = await page.evaluate(async () => {
		const path = '/tests/worker/host-driver.ts'
		return (await import(/* @vite-ignore */ path)).qualifyApplicationHost(true)
	})
	expect(result).toEqual({ closed: true })
	await page.reload()
	await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
})

test('worker provisions the first local account and library without a Window application instance', async ({
	page
}) => {
	await page.route('**/worker-fixture', (route) =>
		route.fulfill({
			contentType: 'text/html',
			body: '<!doctype html><html><body><div id="worker-test"></div></body></html>'
		})
	)
	await page.goto('/worker-fixture')
	await expect(page.locator('#worker-test')).toBeAttached()
	expect(
		await page.evaluate(() =>
			Object.keys(localStorage).filter((key) => key.startsWith('jazz-account-selection-v1:'))
		)
	).toEqual([])
	const result = await page.evaluate(async () => {
		const path = '/tests/worker/host-driver.ts'
		return (await import(/* @vite-ignore */ path)).qualifyApplicationHost()
	})
	expect(result).toMatchObject({
		type: 'VIEW',
		library: { rows: [], total: 0 },
		worker: { windowPresent: false }
	})
	await page.goto('/')
	await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
})
