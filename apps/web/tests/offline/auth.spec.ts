import { openArticleActions } from '../article-actions.js'
import { openAccountSettings, openAllArticles, expectSignedInAccount } from '../account-ui.js'
import { authenticateGateway } from '../../src/lib/server/gateway-auth.js'
import { handleConfiguredAuth } from '../../src/lib/server/auth/completion-handler.js'
import { chromium, expect, test } from '@playwright/test'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { makeSignature } from 'better-auth/crypto'
import { acceptLocalFirstAuth } from 'jazz-tools/backend'
import { createAuthServer } from '../../src/lib/server/auth/server.js'
import { app } from '../../src/lib/backend/jazz/schema.js'
import { startJazzAuthority } from '../jazz-authority.js'
import { staticShellServer } from './server.js'
import { openAddLink } from '../add-link.js'
import { readingControls } from '../reader-ui.js'

// Synthetic provider identity, real Better Auth session verification, real Jazz
// storage/authentication, built worker/UI and persistent browser profile.
for (const mode of ['linked', 'existing', 'expired'])
	test(`native ${mode} account survives two full offline browser restarts and reconnects`, async () => {
		const directory = await mkdtemp(join(tmpdir(), 'clipper-auth-offline-'))
		let profile = join(directory, 'profile')
		const origin = 'http://127.0.0.1:5190'
		const secret = 'native-auth-offline-fixture-secret-at-least-32'
		const ui = staticShellServer(
			fileURLToPath(new URL('../../.offline-test-builds/a/', import.meta.url))
		)
		let auth: ReturnType<typeof createAuthServer>
		const start = async () => {
			const authority = await startJazzAuthority({
				port: 5191,
				origin,
				dataDir: directory,
				authenticate: async (request) => {
					const session = await auth.api.getSession({ headers: request.headers })
					return session ? { userId: session.user.id } : acceptLocalFirstAuth(request)
				}
			})
			auth = createAuthServer({ db: () => authority.backend.db, schema: app }, { origin, secret })
			ui.useAuth((request) => handleConfiguredAuth(auth, request, { origin, secret }))
			await ui.useJazz(authority.backend)
			return authority
		}
		let authority = await start()
		let authorityUp = true
		let context = await chromium.launchPersistentContext(profile, { headless: true })
		try {
			await ui.start()
			let page = await context.newPage()
			await page.goto(origin)
			await expect(page.getByRole('region', { name: 'Saved articles', exact: true })).toBeVisible({
				timeout: 30000
			})
			await expect(page.getByText('Private library synced.', { exact: true })).toBeVisible()
			await expect
				.poll(() => page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state))
				.toBe('activated')
			await page.route('**/api/capture/*', (route) => route.abort())
			await openAddLink(page)
			await page
				.getByLabel('Article URL', { exact: true })
				.fill('https://example.invalid/native-auth-before')
			await page
				.getByRole('dialog', { name: 'Add link', exact: true })
				.getByRole('button', { name: 'Add link', exact: true })
				.click()
			const article = page
				.locator('[data-article-id]')
				.filter({ hasText: 'https://example.invalid/native-auth-before' })
			await expect(article).toBeVisible()
			const id = await article.getAttribute('data-article-id')

			// Use Better Auth's own adapter and signing primitive; no app test route or
			// alternate production identity provider is added.
			const authContext = await auth!.$context
			const user = await authContext.internalAdapter.createUser(
				{
					name: 'Offline AT fixture',
					email: 'offline@example.invalid',
					emailVerified: true
				},
				{
					method: 'oauth',
					oauth: { providerId: 'atproto', profile: { did: 'did:plc:offlinefixture' } }
				}
			)
			const issueSession = async () => {
				const session = await (await auth!.$context).internalAdapter.createSession(user.id)
				await context.addCookies([
					{
						name: (await auth!.$context).authCookies.sessionToken.name,
						value: encodeURIComponent(
							session.token + '.' + (await makeSignature(session.token, secret))
						),
						url: origin,
						expires: Math.floor(session.expiresAt.getTime() / 1000),
						httpOnly: true,
						sameSite: 'Lax'
					}
				])
			}
			await issueSession()
			const verificationCookies = await context.cookies(origin)
			expect(
				(
					await auth!.api.getSession({
						headers: new Headers({
							cookie: verificationCookies
								.map((cookie) => cookie.name + '=' + cookie.value)
								.join('; ')
						})
					})
				)?.user.id
			).toBe(user.id)
			await page.reload()
			await expectSignedInAccount(page)
			await expect(page.locator(`[data-article-id="${id}"]`)).toBeVisible()
			const cookies = await context.cookies(origin)
			const request = new Request(origin + '/api/auth/get-session', {
				headers: { cookie: cookies.map((cookie) => cookie.name + '=' + cookie.value).join('; ') }
			})
			expect((await auth!.api.getSession({ headers: request.headers }))?.user.id).toBe(user.id)
			const accountId = await authority.backend.accountFor(request)
			expect(accountId).toBeTruthy()
			await expect
				.poll(() =>
					authority.backend.db
						.all(app.articles.where({ libraryId: accountId! }))
						.then((rows) => rows.map((row) => row.id))
				)
				.toContain(id)

			await page.unroute('**/api/capture/*')
			await page.route('**/api/capture/*', async (route) => {
				const headers = await route.request().allHeaders()
				expect(headers.authorization).toBeUndefined()
				expect(
					await authenticateGateway(
						new Request(route.request().url(), { headers }),
						authority.backend
					)
				).toEqual({ accountId })
				const body: { operationId: string; url: string } = route.request().postDataJSON()
				const base = { operationId: body.operationId, finalUrl: body.url }
				await route.fulfill({
					json: route.request().url().endsWith('/resolve')
						? base
						: {
								...base,
								provenance: {
									submittedUrl: body.url,
									redirects: [],
									resolvedAt: new Date().toISOString()
								},
								candidate: {
									title: 'Native authorized article',
									text: 'Readable native backend capture.',
									html: '<p>Readable native backend capture.</p>',
									assetCandidates: [],
									partialEvidence: [],
									parserVersion: 'fixture',
									normalizationVersion: '1'
								}
							}
				})
			})
			await (
				await openArticleActions(page.locator(`[data-article-id="${id}"]`))
			)
				.getByRole('button', { name: 'Retry', exact: true })
				.click()
			await expect(
				page.getByRole('link', { name: 'Native authorized article', exact: true })
			).toBeVisible({ timeout: 30000 })
			await expect
				.poll(() =>
					authority.backend.db
						.one(app.articles.where({ id: id! }))
						.then((row) => Boolean(row?.contentId))
				)
				.toBe(true)

			if (mode === 'existing') {
				const persistentCookies = await context.cookies(origin)
				await context.close()
				profile = join(directory, 'existing-profile')
				context = await chromium.launchPersistentContext(profile, { headless: true })
				await context.addCookies(persistentCookies)
				page = await context.newPage()
				await page.goto(origin)
				await expect(page.locator(`[data-article-id="${id}"]`)).toBeVisible({ timeout: 30000 })
				await expectSignedInAccount(page)
				await expect
					.poll(() =>
						page.evaluate(async () => (await navigator.serviceWorker.ready).active?.state)
					)
					.toBe('activated')
			}
			await page.getByRole('link', { name: 'Native authorized article', exact: true }).click()
			await expect(page.getByRole('article')).toContainText('Readable native backend capture.')
			await readingControls(page)
			await page.getByRole('link', { name: 'Open library', exact: true }).click()

			if (mode === 'expired') {
				const sessions = await authority.backend.db.all(
					app.better_auth_session.where({ userId: user.id })
				)
				for (const stored of sessions)
					await authority.backend.db
						.update(app.better_auth_session, stored.id, { expiresAt: new Date(Date.now() - 60000) })
						.wait({ tier: 'global' })
			}

			await context.close()
			await ui.stop()
			await authority.stop()
			authorityUp = false
			for (let restart = 0; restart < 2; restart++) {
				context = await chromium.launchPersistentContext(profile, { headless: true })
				await context.setOffline(true)
				page = await context.newPage()
				const cdp = await context.newCDPSession(page)
				await cdp.send('Network.enable')
				await cdp.send('Network.clearBrowserCache')
				await cdp.detach()
				await page.goto(origin)
				const saved = page.locator(`[data-article-id="${id}"]`)
				await expect(saved).toBeVisible({ timeout: 30000 })
				await expectSignedInAccount(page)
				await openAccountSettings(page)
				const settingsResponse = await page.reload()
				expect(settingsResponse?.fromServiceWorker()).toBe(true)
				await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible()
				await openAllArticles(page)
				if (restart === 0) {
					await (
						await openArticleActions(saved)
					)
						.getByRole('button', { name: 'Favorite', exact: true })
						.click()
					await expect(
						(await openArticleActions(saved)).getByRole('button', {
							name: 'Remove favorite',
							exact: true
						})
					).toBeEnabled()
				} else {
					await expect(
						(await openArticleActions(saved)).getByRole('button', {
							name: 'Remove favorite',
							exact: true
						})
					).toBeVisible()
				}
				await page.getByRole('link', { name: 'Native authorized article', exact: true }).click()
				await expect(page.getByRole('article')).toContainText('Readable native backend capture.')
				await readingControls(page)
				await page.getByRole('link', { name: 'Open library', exact: true }).click()

				if (restart === 0) await context.close()
			}
			authority = await start()
			authorityUp = true
			await ui.start()
			await context.setOffline(false)
			await page.reload()
			if (mode === 'expired') {
				await openAccountSettings(page)
				await expect(
					page.getByRole('button', { name: 'Sign in with AT Protocol', exact: true })
				).toBeVisible({ timeout: 30000 })
				await issueSession()
				await page.reload()
			}
			await expectSignedInAccount(page)

			await expect(
				(await openArticleActions(page.locator(`[data-article-id="${id}"]`))).getByRole('button', {
					name: 'Remove favorite',
					exact: true
				})
			).toBeVisible({ timeout: 30000 })
			await expect
				.poll(() =>
					authority.backend.db
						.all(app.organizationOperations.where({ libraryId: accountId! }))
						.then((rows) => rows.length)
				)
				.toBeGreaterThan(0)
			if (mode === 'linked') {
				const signingOut = page.waitForResponse(
					(response) => new URL(response.url()).pathname === '/api/auth/sign-out'
				)
				await openAccountSettings(page)
				await page.getByRole('button', { name: 'Sign out', exact: true }).click()
				const signOutResponse = await signingOut
				expect(signOutResponse.status(), await signOutResponse.text()).toBe(200)
				await expect(
					page.getByRole('button', { name: 'Sign in with AT Protocol', exact: true })
				).toBeVisible({ timeout: 30000 })
				await page.getByRole('link', { name: 'All articles', exact: true }).click()
				await expect(page).toHaveURL(origin + '/')
				await expect(page.locator(`[data-article-id="${id}"]`)).toHaveCount(0)
				const signedOutCookies = await context.cookies(origin)
				expect(
					await auth!.api.getSession({
						headers: new Headers({
							cookie: signedOutCookies.map((cookie) => cookie.name + '=' + cookie.value).join('; ')
						})
					})
				).toBeNull()
				await context.close()
				await ui.stop()
				await authority.stop()
				authorityUp = false
				context = await chromium.launchPersistentContext(profile, { headless: true })
				await context.setOffline(true)
				const afterSignOut = await context.newPage()
				await afterSignOut.goto(origin)
				await expect(
					afterSignOut.getByRole('region', { name: 'Saved articles', exact: true })
				).toBeVisible({ timeout: 30000 })
				await expect(afterSignOut.locator(`[data-article-id="${id}"]`)).toHaveCount(0)
				await openAccountSettings(afterSignOut)
				await expect(
					afterSignOut.getByRole('button', { name: 'Sign out', exact: true })
				).toHaveCount(0)
			}
		} finally {
			await context.close()
			await ui.stop()
			if (authorityUp) await authority.stop()
			await rm(directory, { recursive: true, force: true })
		}
	})
