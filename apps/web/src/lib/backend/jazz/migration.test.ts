import noteMigration from './migrations/20261106T132300-article-notes-dc1365b4b2ec-d7f861eae955.js'
import { app as preNotesApp } from './prenotes-schema.test-support.js'
import { app as preImageApp } from './preimages-schema.test-support.js'
import imageMigration from './migrations/20261106T025204-offline-images-3d99c179e109-dc1365b4b2ec.js'
import { ReadTier } from 'jazz-tools'
import readerMigration from './migrations/20261105T215835-reader-experience-86d3840835d8-3d99c179e109.js'
import { app as preReaderApp } from './prereader-schema.test-support.js'
import discoveryMigration from './migrations/20261105T143555-search-tags-trash-5315ce57b805-86d3840835d8.js'
import { app as preDiscoveryApp } from './prediscovery-schema.test-support.js'
import { it, expect } from 'vitest'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createActor, toPromise } from 'xstate'
import { createJazzSession } from 'jazz-tools/backend'
import { startLocalJazzServer, deploy } from 'jazz-tools/dev'
import { app } from './schema.js'
import { legacyApp } from './legacy-schema.test-support.js'
import permissions from './permissions.js'
import { app as preOrganizationApp } from './preorganization-schema.test-support.js'
import organizationMigration from './migrations/20261105T033336-library-organization-80988faa7219-5315ce57b805.js'
import migration from './migrations/20261103T231346-url-first-articles-9251313c0afe-80988faa7219.js'
import { createLibraryRecords } from './records.js'
import { readRecord } from '../../machines/storage/read.test-support.js'

it('upgrades a persisted pre-article library without resetting its root or readable content', async () => {
	const legacySchema: typeof app.wasmSchema = JSON.parse(
		await readFile(
			new URL('./migrations/snapshots/20261103T173927-9251313c0afe.json', import.meta.url),
			'utf8'
		)
	)
	const legacyPermissions = Object.fromEntries(
		Object.entries(permissions)
			.filter(([table]) => table !== 'articleNoteRevisions')
			.filter(([table]) => table !== 'readerOperations' && table !== 'articleImages')
			.filter(
				([table]) =>
					table !== 'articles' && table !== 'organizationOperations' && table !== 'tagOperations'
			)
	)
	const dataDir = await mkdtemp(join(tmpdir(), 'clipper-upgrade-'))
	const serverOptions = {
		appId: crypto.randomUUID(),
		dataDir: join(dataDir, 'authority'),
		backendSecret: 'upgrade-test-backend',
		adminSecret: 'upgrade-test-admin'
	}
	let server = await startLocalJazzServer(serverOptions)
	const config = {
		appId: server.appId,
		serverUrl: server.url,
		driver: { type: 'persistent' as const, dataPath: join(dataDir, 'replica') },
		env: 'test' as const
	}
	let storedAccount: string | null = null
	const store = {
		read: async () => storedAccount,
		update: async (transform: (current: string | null) => string) => {
			storedAccount = transform(storedAccount)
		}
	}
	let context: Awaited<ReturnType<typeof createJazzSession>> | undefined
	const documentId = crypto.randomUUID()
	try {
		await deploy({
			appId: server.appId,
			serverUrl: server.url,
			adminSecret: serverOptions.adminSecret,
			schema: legacySchema,
			permissions: legacyPermissions
		})
		context = await createJazzSession({
			...config,
			app: legacyApp,
			permissions: legacyPermissions,
			store,
			initial: 'local-first'
		})
		const owner = context.getSnapshot().account?.id
		const db = context.getSnapshot().client?.db
		if (!owner || !db) throw new Error('Expected legacy local-first library')
		await db
			.insert(legacyApp.libraries, { ownerId: owner, bootstrapVersion: '1' }, { id: owner })
			.wait({ tier: 'global' })
		const tx = db.beginTransaction()
		tx.insert(
			legacyApp.storageOperations,
			{ libraryId: owner, payloadHash: 'legacy', createdAt: '2026-11-01T00:00:00.000Z' },
			{ id: documentId }
		)
		tx.insert(
			legacyApp.assets,
			{
				libraryId: owner,
				operationId: documentId,
				mediaType: 'text/html',
				payload: new TextEncoder().encode('<p>Legacy text</p>')
			},
			{ id: documentId }
		)
		tx.insert(
			legacyApp.snapshots,
			{ libraryId: owner, documentId, text: 'Legacy text', formatVersion: '1' },
			{ id: documentId }
		)
		tx.insert(
			legacyApp.documents,
			{
				libraryId: owner,
				operationId: documentId,
				snapshotId: documentId,
				assetId: documentId,
				title: 'Legacy article',
				originalSavedAt: '2026-11-01T00:00:00.000Z'
			},
			{ id: documentId }
		)
		await tx.commit().wait({ tier: 'global' })
		await context.close()
		await server.stop()
		server = await startLocalJazzServer({ ...serverOptions, port: server.port })
		const upgrade = {
			appId: server.appId,
			serverUrl: server.url,
			adminSecret: serverOptions.adminSecret,
			schema: app,
			permissions,
			migration
		}
		await deploy({
			...upgrade,
			schema: preOrganizationApp,
			permissions: Object.fromEntries(
				Object.entries(permissions)
					.filter(([table]) => table !== 'articleNoteRevisions')
					.filter(([table]) => table !== 'readerOperations' && table !== 'articleImages')
					.filter(([table]) => table !== 'organizationOperations' && table !== 'tagOperations')
			)
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
		await deploy({ ...upgrade, migration: noteMigration })
		context = await createJazzSession({
			...config,
			serverUrl: server.url,
			app,
			permissions,
			store,
			initial: 'local-first'
		})
		const current = context.getSnapshot().client?.db
		expect(context.getSnapshot().account?.id).toBe(owner)
		if (!current) throw new Error('Expected migrated local-first library')
		expect(await current.one(app.libraries.where({ id: owner }))).toMatchObject({
			ownerId: owner,
			bootstrapVersion: '1'
		})
		const records = createLibraryRecords(current, owner, () => true)
		expect(await readRecord(records.readCapabilities, documentId)).toMatchObject({
			kind: 'available',
			text: 'Legacy text'
		})
		const url = 'https://example.com/after-upgrade'
		const result = await toPromise(
			createActor(records.articles.saveMachine, { input: { url } }).start()
		)
		expect(result.kind).toBe('saved')
		if (result.kind !== 'saved') throw new Error('Expected URL article save after upgrade')
		await Promise.all(result.receipts.map((r) => r.global()))
		const before = await records.articles.read(result.operationId)
		expect(before).toMatchObject({ url, contentId: null })
		const noteId = crypto.randomUUID()
		const note = await toPromise(
			createActor(records.notes.stage, {
				input: {
					attempt: {
						operationId: noteId,
						workspaceId: noteId,
						membershipId: noteId,
						draft: {
							id: noteId,
							libraryId: owner,
							articleId: result.operationId,
							text: 'A note after migration 😀',
							parents: [],
							editedAt: new Date().toISOString()
						}
					}
				}
			}).start()
		)
		if (note.settlement.kind !== 'locallyPersisted') throw new Error('Expected note after upgrade')
		await note.settlement.workspace.global()
		await context.close()
		context = await createJazzSession({
			...config,
			serverUrl: server.url,
			app,
			permissions,
			store,
			initial: 'local-first'
		})
		const reopenedDb = context.getSnapshot().client?.db
		expect(context.getSnapshot().account?.id).toBe(owner)
		if (!reopenedDb) throw new Error('Expected reopened local-first library')
		const reopened = createLibraryRecords(reopenedDb, owner, () => true)
		expect(await reopened.articles.read(result.operationId)).toEqual(before)
		expect(await reopened.notes.readRevision(note.attempt.draft)).toEqual(note.attempt.draft)
		expect(await readRecord(reopened.readCapabilities, documentId)).toMatchObject({
			kind: 'available',
			text: 'Legacy text'
		})
	} finally {
		await context?.close()
		await server.stop()
		await rm(dataDir, { recursive: true, force: true })
	}
})

it('adds tags to a populated organization-era replica without resetting identity, favorites or status', async () => {
	const dataDir = await mkdtemp(join(tmpdir(), 'clipper-discovery-upgrade-'))
	const server = await startLocalJazzServer({ dataDir: join(dataDir, 'authority') })
	const oldPermissions = Object.fromEntries(
		Object.entries(permissions)
			.filter(([table]) => table !== 'articleNoteRevisions')
			.filter(([table]) => table !== 'readerOperations' && table !== 'articleImages')
			.filter(([table]) => table !== 'tagOperations')
	)
	const config = {
		appId: server.appId,
		serverUrl: server.url,
		driver: { type: 'persistent' as const, dataPath: join(dataDir, 'replica') },
		env: 'test' as const
	}
	let identity: string | null = null
	const store = {
		read: async () => identity,
		update: async (transform: (value: string | null) => string) => {
			identity = transform(identity)
		}
	}
	let context: Awaited<ReturnType<typeof createJazzSession>> | undefined
	try {
		await deploy({
			appId: server.appId,
			serverUrl: server.url,
			adminSecret: server.adminSecret,
			schema: preDiscoveryApp,
			permissions: oldPermissions
		})
		context = await createJazzSession({
			...config,
			app: preDiscoveryApp,
			permissions: oldPermissions,
			store,
			initial: 'local-first'
		})
		const owner = context.getSnapshot().account!.id,
			db = context.getSnapshot().client!.db
		await db
			.insert(preDiscoveryApp.libraries, { ownerId: owner, bootstrapVersion: '1' }, { id: owner })
			.wait({ tier: 'global' })
		const articleId = crypto.randomUUID()
		await db
			.insert(
				preDiscoveryApp.articles,
				{
					libraryId: owner,
					url: 'https://example.com/pre-discovery',
					originalSavedAt: '2026-01-01',
					contentId: null,
					operationId: null,
					failure: null
				},
				{ id: articleId }
			)
			.wait({ tier: 'global' })
		for (const [field, value] of [
			['status', 'later'],
			['favorite', 'true']
		])
			await db
				.insert(preDiscoveryApp.organizationOperations, {
					libraryId: owner,
					articleId,
					documentId: null,
					field: field!,
					value: value!,
					parents: '[]'
				})
				.wait({ tier: 'global' })
		await context.close()
		context = undefined
		await deploy({
			appId: server.appId,
			serverUrl: server.url,
			adminSecret: server.adminSecret,
			schema: preReaderApp,
			permissions: Object.fromEntries(
				Object.entries(permissions)
					.filter(([table]) => table !== 'articleNoteRevisions')
					.filter(([table]) => table !== 'readerOperations' && table !== 'articleImages')
			),
			migration: discoveryMigration
		})
		context = await createJazzSession({
			...config,
			app: preReaderApp,
			permissions: Object.fromEntries(
				Object.entries(permissions)
					.filter(([table]) => table !== 'articleNoteRevisions')
					.filter(([table]) => table !== 'readerOperations' && table !== 'articleImages')
			),
			store,
			initial: 'local-first'
		})
		await context
			.getSnapshot()
			.client!.db.one(preReaderApp.libraries.where({ id: owner }), { tier: 'remote' })
		await context
			.getSnapshot()
			.client!.db.insert(preReaderApp.tagOperations, {
				libraryId: owner,
				articleId,
				documentId: null,
				key: 'cf-1.1.2:existing',
				name: 'Existing',
				assigned: true,
				parents: '[]'
			})
			.wait({ tier: 'global' })
		await context.close()
		context = undefined
		await deploy({
			appId: server.appId,
			serverUrl: server.url,
			adminSecret: server.adminSecret,
			schema: preImageApp,
			permissions: Object.fromEntries(
				Object.entries(permissions)
					.filter(([table]) => table !== 'articleNoteRevisions')
					.filter(([table]) => table !== 'articleImages')
			),
			migration: readerMigration
		})
		context = await createJazzSession({
			...config,
			app: preImageApp,
			permissions: Object.fromEntries(
				Object.entries(permissions)
					.filter(([table]) => table !== 'articleNoteRevisions')
					.filter(([table]) => table !== 'articleImages')
			),
			store,
			initial: 'local-first'
		})
		await context
			.getSnapshot()
			.client!.db.one(preImageApp.libraries.where({ id: owner }), { tier: ReadTier.Remote })
		await context
			.getSnapshot()
			.client!.db.insert(preImageApp.readerOperations, {
				libraryId: owner,
				documentId: null,
				field: 'theme',
				value: '"dark"',
				parents: '[]'
			})
			.wait({ tier: 'global' })
		await context.close()
		context = undefined
		await deploy({
			appId: server.appId,
			serverUrl: server.url,
			adminSecret: server.adminSecret,
			schema: preNotesApp,
			permissions: Object.fromEntries(
				Object.entries(permissions).filter(([table]) => table !== 'articleNoteRevisions')
			),
			migration: imageMigration
		})
		await deploy({
			appId: server.appId,
			serverUrl: server.url,
			adminSecret: server.adminSecret,
			schema: app,
			permissions,
			migration: noteMigration
		})
		context = await createJazzSession({
			...config,
			app,
			permissions,
			store,
			initial: 'local-first'
		})
		expect(context.getSnapshot().account?.id).toBe(owner)
		const current = context.getSnapshot().client!.db
		await expect
			.poll(() => current.all(app.readerOperations.where({ libraryId: owner })))
			.toEqual(
				expect.arrayContaining([expect.objectContaining({ field: 'theme', value: '"dark"' })])
			)
		expect(await current.all(app.articleImages.where({ libraryId: owner }))).toEqual([])
		const records = createLibraryRecords(current, owner, () => true)
		await expect
			.poll(() => current.one(app.articles.where({ id: articleId })))
			.toMatchObject({ id: articleId })
		await expect
			.poll(
				async () =>
					(await current.all(app.organizationOperations.where({ libraryId: owner }))).length
			)
			.toBe(2)
		const change = await toPromise(
			createActor(records.articles.organization.machine, {
				input: { id: articleId, field: 'tag', value: 'Migrated', assigned: true }
			}).start()
		)
		expect(change.kind).toBe('saved')
		if (change.kind !== 'saved') throw new Error('Expected tag save')
		await Promise.all(change.receipts.map((receipt) => receipt.global()))
		const rows = await new Promise<import('../../contracts/articles.js').LibraryArticle[]>(
			(resolve) => {
				const stop = records.articles.subscribe(
					(rows) => {
						if (rows.some((row) => row.tags?.length && row.status === 'later' && row.favorite)) {
							queueMicrotask(() => stop())
							resolve(rows)
						}
					},
					() => {
						throw new Error('Collection unavailable')
					}
				)
			}
		)
		expect(rows[0]).toMatchObject({
			id: articleId,
			status: 'later',
			favorite: true,
			trashed: false,
			tags: [{ name: 'Existing' }, { name: 'Migrated' }],
			originalSavedAt: '2026-01-01'
		})
	} finally {
		await context?.close()
		await server.stop()
		await rm(dataDir, { recursive: true, force: true })
	}
}, 30000)
