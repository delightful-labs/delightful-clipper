import { test, expect } from '@playwright/test'
import { openLibrarySearch, closeLibraryPopovers } from '../library-popovers.js'
import { readingControls } from '../reader-ui.js'
import { readRecoveryPhrase } from '../account-ui.js'
import type { WorkerReply } from '../../src/lib/runtime/worker/client.js'

declare global {
	interface Window {
		releaseViewportReceipt: () => number
		restoreViewportAccount: (phrase: string) => void
		viewportReplacementReady: () => boolean
	}
}

for (const failure of ['INDEX', 'QUERY', 'messageerror', 'post'] as const) {
	test(`search recovers from native ${failure} failure without losing the saved library`, async ({
		page
	}) => {
		await page.goto('/')
		await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
		await page.evaluate(async () => {
			const path = '/tests/worker/host-driver.ts'
			await (await import(/* @vite-ignore */ path)).qualifyHost()
		})
		await page.reload()
		await expect(page.getByRole('link', { name: 'Worker proof', exact: true })).toBeVisible()
		const worker = page.workers().find((value) => value.url().includes('application.worker'))
		if (!worker) throw new Error('Application worker unavailable')
		await worker.evaluate((failure) => {
			const NativeWorker = globalThis.Worker
			let claimed = false
			globalThis.Worker = class extends NativeWorker {
				faulty = false
				constructor(url: string | URL, options?: WorkerOptions) {
					super(url, options)
					if (!claimed && String(url).includes('/search/worker')) {
						claimed = true
						this.faulty = true
					}
				}
				postMessage(message: unknown, transfer?: Transferable[] | StructuredSerializeOptions) {
					const type =
						message && typeof message === 'object' ? Reflect.get(message, 'type') : undefined
					if (this.faulty && type === (failure === 'QUERY' ? 'QUERY' : 'INDEX')) {
						if (failure === 'post') throw new Error('Native post refused')
						if (failure === 'messageerror') this.dispatchEvent(new MessageEvent('messageerror'))
						return
					}
					if (Array.isArray(transfer)) super.postMessage(message, transfer)
					else super.postMessage(message, transfer)
				}
			}
		}, failure)
		await openLibrarySearch(page)
		await page.getByRole('searchbox', { name: 'Search articles', exact: true }).fill('Worker')
		await closeLibraryPopovers(page)
		await expect(page.getByText('Search is unavailable.', { exact: true })).toBeVisible({
			timeout: 20_000
		})
		// An unresolved nonempty search has no result IDs. Clearing that filter
		// must still reveal the original locally saved library during failure.
		await openLibrarySearch(page)
		await page.getByRole('searchbox', { name: 'Search articles', exact: true }).fill('')
		await closeLibraryPopovers(page)
		await expect(page.getByRole('link', { name: 'Worker proof', exact: true })).toBeVisible()
		await page.getByRole('button', { name: 'Retry', exact: true }).click()
		await expect(page.getByText('Search is unavailable.', { exact: true })).toHaveCount(0)
		await expect(page.getByRole('link', { name: 'Worker proof', exact: true })).toBeVisible()
		// Prove a new query is served by the recreated native index worker.
		await openLibrarySearch(page)
		await page
			.getByRole('searchbox', { name: 'Search articles', exact: true })
			.fill('absent-from-saved-text')
		await closeLibraryPopovers(page)
		await expect(page.getByRole('link', { name: 'Worker proof', exact: true })).toHaveCount(0)
		await openLibrarySearch(page)
		await page.getByRole('searchbox', { name: 'Search articles', exact: true }).fill('Worker')
		await closeLibraryPopovers(page)
		await expect(page.getByRole('link', { name: 'Worker proof', exact: true })).toBeVisible()
	})
}

for (const wait of ['open', 'detach', 'replacement'] as const) {
	test(`reader ${wait} timeout retains the real surface until its late cleanup receipt`, async ({
		page,
		browser
	}) => {
		await page.addInitScript((wait) => {
			if (wait === 'replacement') {
				const NativeWorker = window.Worker
				window.Worker = class extends NativeWorker {
					constructor(url: string | URL, options?: WorkerOptions) {
						super(url, options)
						if (!String(url).includes('application.worker')) return
						let view: Extract<WorkerReply, { type: 'VIEW' }> | undefined
						let previous: string | undefined
						this.addEventListener('message', ({ data }: MessageEvent<WorkerReply>) => {
							if (data.type === 'VIEW') view = data
						})
						window.restoreViewportAccount = (phrase) => {
							if (!view?.library) throw new Error('Bound library unavailable')
							previous = view.library.scope
							this.postMessage({
								type: 'ACCOUNT',
								scope: view.scope,
								event: { type: 'RESTORE', phrase }
							})
						}
						window.viewportReplacementReady = () =>
							!!view?.library && view.library.scope !== previous
					}
				}
			}
			const nativePost = MessagePort.prototype.postMessage
			const held: { port: MessagePort; message: unknown }[] = []
			let blocking = true
			MessagePort.prototype.postMessage = function (
				message: unknown,
				transfer?: Transferable[] | StructuredSerializeOptions
			) {
				const type =
					message && typeof message === 'object' ? Reflect.get(message, 'type') : undefined
				if (blocking && type === 'VIEWPORT_OPENED' && wait === 'open') return
				if (blocking && type === 'VIEWPORT_SETTLED') {
					held.push({ port: this, message })
					return
				}
				nativePost.call(this, message, Array.isArray(transfer) ? { transfer } : transfer)
			}
			window.releaseViewportReceipt = () => {
				blocking = false
				for (const { port, message } of held) nativePost.call(port, message, {})
				return held.length
			}
		}, wait)
		let overdue = false,
			draining = false,
			leaseClosed = false
		page.on('console', (message) => {
			const text = message.text()
			if (text.includes('"machine":"reader-surface-viewport"') && text.includes('remote.overdue'))
				overdue = true
			if (text.includes('"machine":"worker-host"') && text.includes('running.draining'))
				draining = true
			if (text.includes('"machine":"reader-surface-lease"') && text.includes('"closed"'))
				leaseClosed = true
		})
		await page.goto('/')
		await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
		await page.evaluate(async () => {
			const path = '/tests/worker/host-driver.ts'
			await (await import(/* @vite-ignore */ path)).qualifyHost()
		})
		await page.reload()
		await page.getByRole('link', { name: 'Worker proof', exact: true }).click()
		await expect(page.getByRole('article')).toContainText('Saved in a worker.')
		if (wait === 'replacement') {
			const independent = await browser.newContext()
			try {
				const other = await independent.newPage()
				await other.goto(new URL(page.url()).origin)
				const phrase = await readRecoveryPhrase(other)
				await page.evaluate((value) => window.restoreViewportAccount(value), phrase)
				await expect.poll(() => overdue, { timeout: 15_000 }).toBe(true)
				await expect(page.getByRole('article')).toHaveCount(0)
				expect(await page.evaluate(() => window.viewportReplacementReady())).toBe(false)
				expect(leaseClosed).toBe(false)
				expect(await page.evaluate(() => window.releaseViewportReceipt())).toBe(1)
				await expect.poll(() => leaseClosed).toBe(true)
				// A host-level overdue warning permits the existing reload recovery;
				// it must reopen B rather than expose A's old saved reader.
				await page.goto(new URL(page.url()).origin)
				await page.reload()
				await expect(
					page.getByRole('region', { name: 'Saved articles', exact: true })
				).toBeVisible()
				await expect(page.getByRole('link', { name: 'Worker proof', exact: true })).toHaveCount(0)
			} finally {
				await independent.close()
			}
			return
		}
		if (wait === 'detach') {
			await readingControls(page)
			await page.getByRole('link', { name: 'Open library', exact: true }).click()
		}
		await expect.poll(() => overdue, { timeout: 15_000 }).toBe(true)
		const worker = page.workers().find((value) => value.url().includes('application.worker'))
		if (!worker) throw new Error('Application worker unavailable')
		let closed = false
		worker.on('close', () => {
			closed = true
		})
		await worker.evaluate(() =>
			self.dispatchEvent(new MessageEvent('message', { data: { type: 'SHUTDOWN' } }))
		)
		await expect.poll(() => draining).toBe(true)
		expect(closed).toBe(false)
		const finished = worker.waitForEvent('close', { timeout: 15_000 })
		expect(await page.evaluate(() => window.releaseViewportReceipt())).toBe(1)
		await finished
	})
}
