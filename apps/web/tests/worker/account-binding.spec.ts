import { test, expect } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { WorkerReply } from '../../src/lib/runtime/worker/client.js'
import { readRecoveryPhrase } from '../account-ui.js'

declare global {
	interface Window {
		clipperBindingTest: {
			restore: (phrase: string) => string
			readyAfter: (scope: string) => boolean
			reveal: () => void
			matchesRecovery: (phrase: string) => boolean
			hide: () => void
		}
	}
}
/** Keep the real native Worker and production command protocol. Settings now live
 * on another route; send the same command here to exercise replacement while the
 * reader DOM is still attached. No production test hook or SDK mock is installed. */
async function observeNativeClient(page: Page) {
	await page.addInitScript(() => {
		const NativeWorker = window.Worker
		window.Worker = class extends NativeWorker {
			constructor(url: string | URL, options?: WorkerOptions) {
				super(url, options)
				if (!String(url).includes('application.worker')) return
				let view: Extract<WorkerReply, { type: 'VIEW' }> | undefined
				let recovery: Extract<WorkerReply, { type: 'RECOVERY' }> | undefined
				this.addEventListener('message', ({ data }: MessageEvent<WorkerReply>) => {
					if (data.type === 'VIEW') view = data
					if (data.type === 'RECOVERY') recovery = data
				})
				window.clipperBindingTest = {
					restore: (phrase) => {
						if (!view) throw new Error('Application view unavailable')
						this.postMessage({
							type: 'ACCOUNT',
							scope: view.scope,
							event: { type: 'RESTORE', phrase }
						})
						return view.scope
					},
					readyAfter: (scope) =>
						!!view?.library &&
						view.scope !== scope &&
						recovery?.available === true &&
						recovery.scope === view.scope,
					reveal: () =>
						this.postMessage({
							type: 'RECOVERY',
							scope: recovery?.scope,
							event: { type: 'REVEAL' }
						}),
					matchesRecovery: (phrase) =>
						recovery?.view.kind === 'revealed' && recovery.view.phrase === phrase,
					hide: () =>
						this.postMessage({ type: 'RECOVERY', scope: recovery?.scope, event: { type: 'HIDE' } })
				}
			}
		}
	})
}
async function seed(page: Page) {
	await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
	await page.evaluate(async () => {
		// The existing native SDK fixture owns its own Worker and clean close.
		const path = '/tests/worker/host-driver.ts'
		return (await import(/* @vite-ignore */ path)).qualifyHost()
	})
	const link = page.getByRole('link', { name: 'Worker proof', exact: true })
	await expect(link).toBeVisible()
	const href = await link.getAttribute('href')
	if (!href) throw new Error('Missing saved reader URL')
	return href
}
async function restore(page: Page, phrase: string) {
	const oldScope = await page.evaluate((value) => window.clipperBindingTest.restore(value), phrase)
	await expect
		.poll(() => page.evaluate((scope) => window.clipperBindingTest.readyAfter(scope), oldScope))
		.toBe(true)
}
test('native restoration retires an attached A reader across A → B → A without exposing the other library', async ({
	page,
	browser
}) => {
	await observeNativeClient(page)
	await page.goto('/')
	const origin = new URL(page.url()).origin
	const aReader = await seed(page),
		aPhrase = await readRecoveryPhrase(page)
	const isolated = await browser.newContext()
	try {
		const b = await isolated.newPage()
		await b.goto(origin)
		const bReader = await seed(b),
			bPhrase = await readRecoveryPhrase(b)
		expect(aReader === bReader).toBe(false)
		await page.getByRole('link', { name: 'Worker proof', exact: true }).click()
		await expect(page.getByRole('article')).toContainText('Saved in a worker.')
		const originalUrl = page.url()
		// The supported restore command changes the native Jazz session while this reader is attached.
		await restore(page, bPhrase)
		await expect(page.getByRole('article')).toHaveCount(0)
		await page.evaluate(() => window.clipperBindingTest.reveal())
		await expect
			.poll(() =>
				page.evaluate((value) => window.clipperBindingTest.matchesRecovery(value), bPhrase)
			)
			.toBe(true)
		await page.evaluate(() => window.clipperBindingTest.hide())
		expect(page.url()).toBe(originalUrl)
		await restore(page, aPhrase)
		await expect(page.getByRole('article')).toContainText('Saved in a worker.')
		expect(page.url()).toBe(originalUrl)
	} finally {
		await isolated.close()
	}
})
