import { test, expect, type Browser, type Page } from '@playwright/test'
import { z } from 'zod'
import { openArticleActions } from '../article-actions.js'

const elapsed = 2 * 60 * 60 * 1000

/** Advance only this disposable browser's broker clock; keep the real OS clock untouched. */
async function ageBroker(browser: Browser) {
	const cdp = await browser.newBrowserCDPSession()
	try {
		const { targetInfos } = z
			.object({
				targetInfos: z.array(z.object({ targetId: z.string(), type: z.string(), url: z.string() }))
			})
			.parse(await cdp.send('Target.getTargets'))
		const brokers = targetInfos.filter(
			(target) =>
				target.type === 'shared_worker' &&
				target.url.startsWith('http://127.0.0.1:5480/') &&
				target.url.includes('jazz-broker-worker')
		)
		expect(brokers).toHaveLength(1)
		const target = brokers[0]
		if (!target) throw new Error('Expected the disposable broker')
		const { sessionId } = z
			.object({ sessionId: z.string() })
			.parse(await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false }))
		const result = Promise.withResolvers<void>()
		const receive = (event: { sessionId: string; message: string }) => {
			if (event.sessionId !== sessionId) return
			const message = z
				.object({
					id: z.number().optional(),
					error: z.unknown().optional(),
					result: z.object({ exceptionDetails: z.unknown().optional() }).optional()
				})
				.parse(JSON.parse(event.message))
			if (message.id !== 1) return
			if (message.error || message.result?.exceptionDetails)
				result.reject(new Error('Broker test clock failed'))
			else result.resolve()
		}
		cdp.on('Target.receivedMessageFromTarget', receive)
		try {
			await cdp.send('Target.sendMessageToTarget', {
				sessionId,
				message: JSON.stringify({
					id: 1,
					method: 'Runtime.evaluate',
					params: {
						expression: `(() => { const now = Date.now.bind(Date); Date.now = () => now() + ${elapsed}; })()`
					}
				})
			})
			await result.promise
		} finally {
			cdp.off('Target.receivedMessageFromTarget', receive)
			await cdp.send('Target.detachFromTarget', { sessionId })
		}
	} finally {
		await cdp.detach()
	}
}

/** The application stays real; vary only proof time/signature in the joining worker. */
async function joiningWorker(
	page: Page,
	mode: 'fresh' | 'expired' | 'forged' | 'audience' | 'identity'
) {
	await page.route('**/application.worker.ts?worker_file*', async (route) => {
		const response = await route.fetch()
		const preamble = `
			const testNow = Date.now.bind(Date);
			Date.now = () => testNow() + ${mode === 'expired' ? 0 : elapsed};
			const testPublish = self.postMessage;
			self.postMessage = function(data, ...args) {
				if(data?.type === 'VIEW' && data.account?.status === 'rootFailed')
					Date.now = () => testNow() + ${elapsed};
				return Reflect.apply(testPublish, self, [data, ...args]);
			};
			const testPost = MessagePort.prototype.postMessage;
			let testFirst = true;
			MessagePort.prototype.postMessage = function(data, ...args) {
				if(testFirst && data?.type === 'connect-runtime' && data.options?.selfSignedClientProof) {
					testFirst = false;
					if(${JSON.stringify(mode)} === 'forged') {
						const proof = data.options.selfSignedClientProof;
						const parts = proof.token.split('.');
						parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
						data = {...data, options:{...data.options, selfSignedClientProof:{...proof, token:parts.join('.')}}};
					}
					if(${JSON.stringify(mode)} === 'audience' || ${JSON.stringify(mode)} === 'identity') {
						const proof = data.options.selfSignedClientProof;
						const change = ${JSON.stringify(mode)} === 'audience' ? {appId:'different-app'} : {claimedAuthor:'different-account'};
						data = {...data, options:{...data.options, selfSignedClientProof:{...proof,...change}}};
					}
				}
				return Reflect.apply(testPost, this, [data, ...args]);
			};
		`
		await route.fulfill({ response, body: preamble + '\n' + (await response.text()) })
	})
}

for (const mode of ['fresh', 'expired', 'forged', 'audience', 'identity'] as const) {
	test(
		mode === 'fresh'
			? 'a new tab opens the same library after the broker proof expires'
			: `refuses a ${mode} proof and recovers through visible Retry while retaining offline edits`,
		async ({ page, browser, context }) => {
			await page.goto('/')
			await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible()
			await page.evaluate(async () => {
				const path = '/tests/article-driver.ts'
				await (
					await import(/* @vite-ignore */ path)
				).supplied('https://example.com/long-lived-broker')
			})
			await expect(page.getByRole('link', { name: 'Supplied clip', exact: true })).toBeVisible()
			await ageBroker(browser)
			const joining = await context.newPage()
			const diagnostics: string[] = []
			joining.on('console', (message) => {
				if (message.text().includes('Machine failure')) diagnostics.push(message.text())
			})

			await joiningWorker(joining, mode)
			await joining.goto('/')
			if (mode !== 'fresh') {
				await expect(
					joining
						.getByRole('main')
						.getByText('The library could not be saved on this device. Retry to continue.', {
							exact: true
						})
				).toBeVisible()
				await expect(
					joining.getByRole('region', { name: 'Saved articles', exact: true })
				).toHaveCount(0)
				await expect(page.getByRole('link', { name: 'Supplied clip', exact: true })).toBeVisible()
				await context.setOffline(true)
				await (
					await openArticleActions(page.locator('[data-article-id]'))
				)
					.getByRole('button', { name: 'Favorite', exact: true })
					.click()
				await expect(
					(await openArticleActions(page.locator('[data-article-id]'))).getByRole('button', {
						name: 'Remove favorite',
						exact: true
					})
				).toBeEnabled()
				await joining.getByRole('main').getByRole('button', { name: 'Retry', exact: true }).click()
			}
			try {
				await expect(
					joining.getByRole('link', { name: 'Supplied clip', exact: true })
				).toBeVisible()
			} catch (error) {
				console.info(
					JSON.stringify({ mode, view: await joining.getByRole('main').innerText(), diagnostics })
				)
				throw error
			}
			await expect(joining.locator('[data-article-id]')).toHaveCount(1)
			const actions = await openArticleActions(joining.locator('[data-article-id]'))
			if (mode !== 'fresh') {
				await expect(
					actions.getByRole('button', { name: 'Remove favorite', exact: true })
				).toHaveAttribute('aria-pressed', 'true')
				await actions.getByRole('button', { name: 'Remove favorite', exact: true }).click()
				await expect(
					(await openArticleActions(page.locator('[data-article-id]'))).getByRole('button', {
						name: 'Favorite',
						exact: true
					})
				).toHaveAttribute('aria-pressed', 'false')
			} else {
				await actions.getByRole('button', { name: 'Favorite', exact: true }).click()
				await expect(
					(await openArticleActions(page.locator('[data-article-id]'))).getByRole('button', {
						name: 'Remove favorite',
						exact: true
					})
				).toHaveAttribute('aria-pressed', 'true')
			}
			await expect(
				joining.getByRole('main').getByRole('button', { name: 'Retry', exact: true })
			).toHaveCount(0)
			await joining.close()
		}
	)
}
