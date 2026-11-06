import noteMigration from '../src/lib/backend/jazz/migrations/20261106T144240-article-notes-with-parent-references-dc1365b4b2ec-b7805d9b30d2.js'
import { app as preNotesApp } from '../src/lib/backend/jazz/prenotes-schema.test-support.js'
import { app as preImageApp } from '../src/lib/backend/jazz/preimages-schema.test-support.js'
import imageMigration from '../src/lib/backend/jazz/migrations/20261106T025204-offline-images-3d99c179e109-dc1365b4b2ec.js'
import readerMigration from '../src/lib/backend/jazz/migrations/20261105T215835-reader-experience-86d3840835d8-3d99c179e109.js'
import { app as preReaderApp } from '../src/lib/backend/jazz/prereader-schema.test-support.js'
import discoveryMigration from '../src/lib/backend/jazz/migrations/20261105T143555-search-tags-trash-5315ce57b805-86d3840835d8.js'
import { app as preDiscoveryApp } from '../src/lib/backend/jazz/prediscovery-schema.test-support.js'
import { openAddLink } from './add-link.js'
import { test, expect, chromium, firefox } from '@playwright/test'
import type { Page } from '@playwright/test'
import { startLocalJazzServer, deploy } from 'jazz-tools/dev'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { legacyApp } from '../src/lib/backend/jazz/legacy-schema.test-support.js'
import { app } from '../src/lib/backend/jazz/schema.js'
import permissions from '../src/lib/backend/jazz/permissions.js'
import { app as preOrganizationApp } from '../src/lib/backend/jazz/preorganization-schema.test-support.js'
import organizationMigration from '../src/lib/backend/jazz/migrations/20261105T033336-library-organization-80988faa7219-5315ce57b805.js'
import migration from '../src/lib/backend/jazz/migrations/20261103T231346-url-first-articles-9251313c0afe-80988faa7219.js'
const appId = '2db98ae3-fcf1-41e8-b7d3-9818496bde60'
const baseURL = 'http://127.0.0.1:5180'
const legacyPermissions = Object.fromEntries(
	Object.entries(permissions)
		.filter(([table]) => table !== 'articleNoteRevisions')
		.filter(([table]) => table !== 'readerOperations' && table !== 'articleImages')
		.filter(
			([table]) =>
				table !== 'articles' && table !== 'organizationOperations' && table !== 'tagOperations'
		)
)
async function savedArticle(page: Page, url: string) {
	return page.evaluate(async (url) => {
		const path = '/tests/article-driver.ts'
		const [row] = await (await import(/* @vite-ignore */ path)).inspect([url])
		return row ? { id: row.id, url: row.url, originalSavedAt: row.originalSavedAt } : null
	}, url)
}
async function expectLegacyReader(page: Page, diagnostics: string[]) {
	try {
		await expect(
			page.locator('article').getByText('Legacy browser content', { exact: true })
		).toBeVisible()
	} catch (error) {
		// The observer emits only allowlisted state paths/outcomes, never actor context or credentials.
		console.info(
			'Legacy reader lifecycle',
			JSON.stringify(diagnostics.filter((line) => line.includes('clipper:machines')).slice(-60))
		)
		console.info(
			'Legacy reader presentation',
			JSON.stringify({
				articleCount: await page.locator('article').count(),
				statuses: await page.getByRole('status').allTextContents()
			})
		)
		throw error
	}
}
for (const browser of [chromium, firefox]) {
	for (const rejectedFirst of [false, true]) {
		for (const keepOpen of [false, true]) {
			test(`${browser.name()}: ${keepOpen ? 'live' : 'cold'} schema upgrade ${rejectedFirst ? 'after rejected deployment and refresh' : 'with migration before new client'}`, async () => {
				test.setTimeout(90000)
				const directory = await mkdtemp(join(tmpdir(), 'clipper-browser-upgrade-'))
				const authority = await startLocalJazzServer({
					appId,
					host: '127.0.0.1',
					port: 5181,
					dataDir: join(directory, 'authority')
				})
				let context = await browser.launchPersistentContext(join(directory, 'profile'), {
					headless: true
				})
				const upgrade = {
					appId,
					serverUrl: authority.url,
					adminSecret: authority.adminSecret,
					schema: app,
					permissions
				}
				const diagnostics: string[] = []
				const observe = async (page: Page) => {
					page.on('console', (message) => {
						if (message.text().includes('[clipper:')) diagnostics.push(message.text())
					})
					// Keep every reopened worker attempt deterministic; only account/storage/sync are real.
					await page.route('**/api/capture/resolve', (route) =>
						route.fulfill({ status: 503, json: { code: 'gatewayUnavailable' } })
					)
				}

				try {
					// Match the managed dev server: start empty, then publish the old catalogue and permissions.
					await deploy({ ...upgrade, schema: legacyApp, permissions: legacyPermissions })
					let page = await context.newPage()
					await observe(page)
					await page.route(baseURL + '/tests/schema-upgrade-fixture', (route) =>
						route.fulfill({
							contentType: 'text/html',
							body: '<!doctype html><html lang="en"><head><title>Upgrade fixture</title></head><body></body></html>'
						})
					)
					await page.goto(baseURL + '/tests/schema-upgrade-fixture')
					const before = await page.evaluate(async (keepOpen) => {
						const path = '/tests/schema-upgrade-driver.ts'
						return (await import(/* @vite-ignore */ path)).seedLegacy(keepOpen)
					}, keepOpen)
					if (!keepOpen) await context.close()
					if (rejectedFirst) {
						await expect(deploy(upgrade)).rejects.toThrow(/migration|connect/i)
						if (!keepOpen)
							context = await browser.launchPersistentContext(join(directory, 'profile'), {
								headless: true
							})
						page = await context.newPage()
						await observe(page)
						await page.goto(baseURL)
						// Qualify real application reads before authority migration, even if admission remains pending.
						await expect
							.poll(() =>
								diagnostics.some(
									(line) => line.includes('root-bootstrap') && line.includes('reading')
								)
							)
							.toBe(true)
						const input = page.getByLabel('Article URL', { exact: true })
						if (await page.getByRole('button', { name: 'Add link', exact: true }).isVisible()) {
							await openAddLink(page)
							await input.fill('https://example.com/before-migration')
							await page
								.getByRole('dialog', { name: 'Add link', exact: true })
								.getByRole('button', { name: 'Add link', exact: true })
								.click()
							await expect(
								page.getByRole('button', { name: 'Add link', exact: true })
							).toBeEnabled()
						}
						const reads = diagnostics.filter(
							(line) => line.includes('root-bootstrap') && line.includes('reading')
						).length
						await page.reload()
						await expect
							.poll(
								() =>
									diagnostics.filter(
										(line) => line.includes('root-bootstrap') && line.includes('reading')
									).length
							)
							.toBeGreaterThan(reads)
						if (!keepOpen) await context.close()
					}
					// In the live case the old client and any waiting new client remain open during publication.
					await deploy({
						...upgrade,
						schema: preOrganizationApp,
						permissions: Object.fromEntries(
							Object.entries(permissions)
								.filter(([table]) => table !== 'articleNoteRevisions')
								.filter(([table]) => table !== 'readerOperations' && table !== 'articleImages')
								.filter(
									([table]) => table !== 'organizationOperations' && table !== 'tagOperations'
								)
						),
						migration
					})
					await deploy({
						...upgrade,
						schema: preDiscoveryApp,
						permissions: Object.fromEntries(
							Object.entries(permissions)
								.filter(([table]) => table !== 'articleNoteRevisions')
								.filter(([table]) => table !== 'readerOperations' && table !== 'articleImages')
								.filter(([table]) => table !== 'tagOperations')
						),
						migration: organizationMigration
					})
					await deploy({
						...upgrade,
						schema: preReaderApp,
						permissions: Object.fromEntries(
							Object.entries(permissions)
								.filter(([table]) => table !== 'articleNoteRevisions')
								.filter(([table]) => table !== 'readerOperations' && table !== 'articleImages')
						),
						migration: discoveryMigration
					})
					await deploy({
						...upgrade,
						schema: preImageApp,
						permissions: Object.fromEntries(
							Object.entries(permissions)
								.filter(([table]) => table !== 'articleNoteRevisions')
								.filter(([table]) => table !== 'articleImages')
						),
						migration: readerMigration
					})
					await deploy({
						...upgrade,
						schema: preNotesApp,
						permissions: Object.fromEntries(
							Object.entries(permissions).filter(([table]) => table !== 'articleNoteRevisions')
						),
						migration: imageMigration
					})
					await deploy({ ...upgrade, migration: noteMigration })
					if (!keepOpen)
						context = await browser.launchPersistentContext(join(directory, 'profile'), {
							headless: true
						})
					page = await context.newPage()
					await observe(page)
					await page.goto(baseURL)
					if (keepOpen) {
						// The SDK refuses simultaneous schema fingerprints for the same physical root.
						// This is a temporary admission refusal, not permission to reset the database.
						await expect(
							page.getByText('The library could not be saved on this device. Retry to continue.', {
								exact: true
							})
						).toBeVisible()
						expect(
							diagnostics.some((line) =>
								line.includes('incompatible persistent browser configuration')
							)
						).toBe(true)
						await context.close()
						context = await browser.launchPersistentContext(join(directory, 'profile'), {
							headless: true
						})
						page = await context.newPage()
						await observe(page)
						await page.goto(baseURL)
					}
					await expect(page.getByRole('button', { name: 'Add link', exact: true })).toBeEnabled({
						timeout: 20000
					})
					await expect(
						page.getByRole('link', { name: 'Legacy browser article', exact: true })
					).toBeVisible()
					expect(
						await page.evaluate(async (accountId) => {
							const path = '/tests/schema-upgrade-driver.ts'
							return (await import(/* @vite-ignore */ path)).sameAccount(accountId)
						}, before.accountId)
					).toBe(true)
					await page.getByRole('link', { name: 'Legacy browser article', exact: true }).click()
					await expectLegacyReader(page, diagnostics)
					await page.goto(baseURL)
					// Admission precedes collection delivery; wait for the migrated row before
					// clicking the floating action, whose position follows the library content.
					await expect(
						page.getByRole('link', { name: 'Legacy browser article', exact: true })
					).toBeVisible()
					const url = 'https://example.com/after-browser-upgrade'
					await openAddLink(page)
					await page.getByLabel('Article URL', { exact: true }).fill(url)
					await page
						.getByRole('dialog', { name: 'Add link', exact: true })
						.getByRole('button', { name: 'Add link', exact: true })
						.click()
					await expect(page.getByRole('button', { name: 'Add link', exact: true })).toBeEnabled()
					await expect.poll(() => savedArticle(page, url)).not.toBeNull()
					const saved = await savedArticle(page, url)
					await page.reload()
					await expect(page.getByRole('button', { name: 'Add link', exact: true })).toBeEnabled()
					expect(await savedArticle(page, url)).toEqual(saved)
					await context.close()
					context = await browser.launchPersistentContext(join(directory, 'profile'), {
						headless: true
					})
					page = await context.newPage()
					await observe(page)
					await page.goto(baseURL)
					await expect(page.getByRole('button', { name: 'Add link', exact: true })).toBeEnabled()
					expect(await savedArticle(page, url)).toEqual(saved)
					await page.getByRole('link', { name: 'Legacy browser article', exact: true }).click()
					await expectLegacyReader(page, diagnostics)
					expect(
						diagnostics.some((line) =>
							line.includes('durable catalogue must have exactly one genesis schema')
						)
					).toBe(false)
				} finally {
					await context.close()
					await authority.stop()
					await rm(directory, { recursive: true, force: true })
				}
			})
		}
	}
}
