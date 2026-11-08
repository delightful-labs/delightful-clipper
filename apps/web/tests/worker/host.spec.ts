import { z } from 'zod'
import { ACCOUNT_STORAGE_PREFIX } from '../../src/lib/runtime/worker/storage-channel.js'
import { test, expect } from '@playwright/test'
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
		const driver = await import(/* @vite-ignore */ path)
		await driver.workerIntentExists('00000000-0000-4000-8000-000000000000')
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
		await page.evaluate(
			(prefix) => Object.keys(localStorage).filter((key) => key.startsWith(prefix)),
			ACCOUNT_STORAGE_PREFIX
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

test('web UI opens one application worker without loading Jazz WASM on the UI thread', async ({
	page
}) => {
	await page.addInitScript(() => {
		Object.assign(globalThis, { mainThreadWasmCalls: 0 })
		for (const name of ['compile', 'compileStreaming', 'instantiate', 'instantiateStreaming']) {
			const native = Reflect.get(WebAssembly, name)
			if (typeof native !== 'function') continue
			Reflect.set(WebAssembly, name, (...args: unknown[]) => {
				Reflect.set(
					globalThis,
					'mainThreadWasmCalls',
					Number(Reflect.get(globalThis, 'mainThreadWasmCalls')) + 1
				)
				return Reflect.apply(native, WebAssembly, args)
			})
		}
	})
	await page.goto('/')
	await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
	expect(
		page.workers().filter((worker) => worker.url().includes('application.worker'))
	).toHaveLength(1)
	const wasm = await page.evaluate(() => Reflect.get(globalThis, 'mainThreadWasmCalls'))
	expect(wasm).toBe(0)
})

test('worker refuses stale library intent before issuing a save', async ({ page }) => {
	await page.goto('/')
	await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
	const result = await page.evaluate(async () => {
		const path = '/tests/worker/host-driver.ts'
		return (await import(/* @vite-ignore */ path)).qualifyScopedCommands()
	})
	expect(result).toEqual({ valid: true, stale: false })
})
