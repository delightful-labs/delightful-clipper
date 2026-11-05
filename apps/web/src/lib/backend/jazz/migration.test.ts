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
		Object.entries(permissions).filter(
			([table]) => table !== 'articles' && table !== 'organizationOperations'
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
				Object.entries(permissions).filter(([table]) => table !== 'organizationOperations')
			)
		})
		await deploy({ ...upgrade, migration: organizationMigration })
		await deploy({ ...upgrade, migration: organizationMigration })
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
