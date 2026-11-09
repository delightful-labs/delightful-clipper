import { permissionsForSchema } from './schema-permissions.test-support.js'
import preEntityPermissions from './prenote-entities-permissions.test-support.js'
import entityMigration from '../../../../tests/fixtures/schema-history/migrations/20261106T161431-independent-notes-b7805d9b30d2-92a26a023aa5.js'
import { app as preEntitiesApp } from '../../../../tests/fixtures/schema-history/prenote-entities-schema.test-support.js'
import noteMigration from '../../../../tests/fixtures/schema-history/migrations/20261106T144240-article-notes-with-parent-references-dc1365b4b2ec-b7805d9b30d2.js'
import { app as preNotesApp } from '../../../../tests/fixtures/schema-history/prenotes-schema.test-support.js'
import { app as preImageApp } from '../../../../tests/fixtures/schema-history/preimages-schema.test-support.js'
import imageMigration from '../../../../tests/fixtures/schema-history/migrations/20261106T025204-offline-images-3d99c179e109-dc1365b4b2ec.js'
import { ReadTier } from 'jazz-tools'
import readerMigration from '../../../../tests/fixtures/schema-history/migrations/20261105T215835-reader-experience-86d3840835d8-3d99c179e109.js'
import { app as preReaderApp } from '../../../../tests/fixtures/schema-history/prereader-schema.test-support.js'
import discoveryMigration from '../../../../tests/fixtures/schema-history/migrations/20261105T143555-search-tags-trash-5315ce57b805-86d3840835d8.js'
import { app as preDiscoveryApp } from '../../../../tests/fixtures/schema-history/prediscovery-schema.test-support.js'
import { it, expect } from 'vitest'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { createActor, toPromise } from 'xstate'
import {
	createJazzClient as createCoreClient,
	createJazz,
	remote,
	acceptLocalFirstAuth
} from 'jazz-tools/backend'
import { createServer } from 'node:http'
import { startLocalJazzServer as startCore, deploy as deployCore } from 'jazz-tools/dev'
import { app } from './schema.js'
import { legacyApp } from '../../../../tests/fixtures/schema-history/legacy-schema.test-support.js'
import permissions from './permissions.js'
import { app as preOrganizationApp } from '../../../../tests/fixtures/schema-history/preorganization-schema.test-support.js'
import organizationMigration from '../../../../tests/fixtures/schema-history/migrations/20261105T033336-library-organization-80988faa7219-5315ce57b805.js'
import migration from '../../../../tests/fixtures/schema-history/migrations/20261103T231346-url-first-articles-9251313c0afe-80988faa7219.js'
import { createLibraryRecords } from './records.js'
import { readRecord } from '../../machines/storage/read.test-support.js'

// Use the SDK's own hash implementation; it is not publicly re-exported.
const sdkRoot = dirname(createRequire(import.meta.url).resolve('jazz-tools'))
const { computeSchemaHash }: { computeSchemaHash(schema: typeof app.wasmSchema): Promise<string> } =
	await import(pathToFileURL(join(sdkRoot, 'schema-hash.js')).href)
type MigrationEdge = { fromHash: string; toHash: string; forward: unknown[] }
const {
	serializeForwardLenses
}: { serializeForwardLenses(lenses: typeof migration.forward): unknown[] } = await import(
	pathToFileURL(join(sdkRoot, 'dev/catalogue.js')).href
)
const {
	resolveSchemaSource
}: {
	resolveSchemaSource(source: Parameters<typeof createCoreClient>[0]['app']): typeof app.wasmSchema
} = await import(pathToFileURL(join(sdkRoot, 'schema-source.js')).href)
const {
	shipMigrations
}: {
	shipMigrations(
		schema: typeof app.wasmSchema,
		bundle: { schemas: { hash: string; schema: unknown }[]; migrations: MigrationEdge[] }
	): void
} = await import(pathToFileURL(join(sdkRoot, 'runtime/client-migrations.js')).href)
const deployedEdges = new Map<string, MigrationEdge[]>()
const guestPorts = new Map<string, number>()
// Alpha.60 uses a different structural schema hash. Preserve the historical
// witnesses and lenses, resolving their endpoints to the same full fixture
// schemas compiled by the current SDK. This does not claim a cross-SDK upgrade.
const historicalSchemas: Record<string, { wasmSchema: typeof app.wasmSchema }> = {
	'9251313c0afe': legacyApp,
	'80988faa7219': preOrganizationApp,
	'5315ce57b805': preDiscoveryApp,
	'86d3840835d8': preReaderApp,
	'3d99c179e109': preImageApp,
	dc1365b4b2ec: preNotesApp,
	b7805d9b30d2: preEntitiesApp,
	'92a26a023aa5': app
}
async function deploy(input: Parameters<typeof deployCore>[0]) {
	if (!input.migration) return deployCore(input)
	const from = input.migration.fromHash && historicalSchemas[input.migration.fromHash]
	const to = input.migration.toHash && historicalSchemas[input.migration.toHash]
	if (!from || !to) throw new Error('Unknown historical migration fixture endpoint')
	const fromHash = await computeSchemaHash(from.wasmSchema)
	const toHash = await computeSchemaHash(to.wasmSchema)
	const result = await deployCore({
		...input,
		schemas: [from, to],
		migration: { ...input.migration, fromHash, toHash }
	})
	const edges = deployedEdges.get(input.appId) ?? []
	if (!edges.some((edge) => edge.fromHash === fromHash && edge.toHash === toHash)) {
		edges.push({ fromHash, toHash, forward: serializeForwardLenses(input.migration.forward) })
		deployedEdges.set(input.appId, edges)
	}
	return result
}
// Exercise the public backend path: alpha.60's account registry and guest
// admission live here, rather than at the raw core's transport endpoint.
const cores = new Map<string, Awaited<ReturnType<typeof startCore>>>()
async function startLocalJazzServer(input: Parameters<typeof startCore>[0]) {
	const core = await startCore(input)
	if (cores.get(core.appId)?.dataDir !== core.dataDir) {
		deployedEdges.delete(core.appId)
		guestPorts.delete(core.appId)
	}
	cores.set(core.appId, core)
	return core
}
async function createJazzClient(input: Parameters<typeof createCoreClient>[0]) {
	const core = input.appId && cores.get(input.appId)
	if (!core) throw new Error('Missing disposable migration authority')
	const declared = resolveSchemaSource(input.app)
	const edges = deployedEdges.get(core.appId) ?? []
	const connected = new Set([
		await computeSchemaHash(declared),
		...edges.flatMap((edge) => [edge.fromHash, edge.toHash])
	])
	const schemas = await Promise.all(
		Object.values(historicalSchemas).map(async ({ wasmSchema }) => ({
			hash: await computeSchemaHash(wasmSchema),
			schema: { tables: wasmSchema }
		}))
	)
	shipMigrations(declared, {
		schemas: schemas.filter(({ hash }) => connected.has(hash)),
		migrations: edges
	})
	const backend = createJazz({
		app: declared,
		permissions: input.permissions,
		store: remote({ url: core.url, appId: core.appId, secret: core.adminSecret }),
		authenticate: acceptLocalFirstAuth
	})
	const http = createServer((request, response) => backend.nodeHandler(request, response))
	const close = async () => {
		await backend.close()
		http.closeAllConnections()
		await new Promise<void>((resolve) => http.close(() => resolve()))
	}
	try {
		await backend.attach(http)
		await backend.ready()
		await new Promise<void>((resolve, reject) => {
			http.once('error', reject)
			http.listen(guestPorts.get(core.appId) ?? 0, '127.0.0.1', resolve)
		})
		const address = http.address()
		if (!address || typeof address === 'string') throw new Error('Missing migration guest listener')
		guestPorts.set(core.appId, address.port)
		const client = await createCoreClient({
			...input,
			app: declared,
			serverUrl: `http://127.0.0.1:${address.port}/jazz`
		})
		return {
			...client,
			close: async (options?: Parameters<typeof client.close>[0]) => {
				try {
					await client.close(options)
				} finally {
					await close()
				}
			}
		}
	} catch (error) {
		await close()
		throw error
	}
}

it('upgrades a persisted pre-article library without resetting its root or readable content', async () => {
	const legacySchema: typeof app.wasmSchema = JSON.parse(
		await readFile(
			new URL(
				'../../../../tests/fixtures/schema-history/migrations/snapshots/20261103T173927-9251313c0afe.json',
				import.meta.url
			),
			'utf8'
		)
	)
	const legacyPermissions = permissionsForSchema(legacyApp)
	const dataDir = await mkdtemp(join(tmpdir(), 'clipper-upgrade-'))
	const serverOptions = {
		appId: crypto.randomUUID(),
		dataDir: join(dataDir, 'authority'),
		backendSecret: 'upgrade-test-backend',
		adminSecret: 'upgrade-test-admin',
		allowLocalFirstAuth: true,
		schema: legacySchema,
		permissions: legacyPermissions
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
	let context: Awaited<ReturnType<typeof createJazzClient>> | undefined
	const documentId = crypto.randomUUID()
	try {
		await deploy({
			appId: server.appId,
			serverUrl: server.url,
			adminSecret: serverOptions.adminSecret,
			schema: legacySchema,
			permissions: legacyPermissions
		})
		context = await createJazzClient({
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
			permissions: permissionsForSchema(preOrganizationApp)
		})
		await deploy({
			...upgrade,
			schema: preDiscoveryApp,
			permissions: permissionsForSchema(preDiscoveryApp),
			migration: organizationMigration
		})
		await deploy({
			...upgrade,
			schema: preReaderApp,
			permissions: permissionsForSchema(preReaderApp),
			migration: discoveryMigration
		})
		await deploy({
			...upgrade,
			schema: preImageApp,
			permissions: permissionsForSchema(preImageApp),
			migration: readerMigration
		})
		await deploy({
			...upgrade,
			schema: preNotesApp,
			permissions: permissionsForSchema(preNotesApp),
			migration: imageMigration
		})
		await deploy({
			...upgrade,
			schema: preEntitiesApp,
			permissions: permissionsForSchema(preEntitiesApp),
			migration: noteMigration
		})
		await deploy({ ...upgrade, migration: entityMigration })
		await deploy({ ...upgrade, migration: entityMigration })
		context = await createJazzClient({
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
		const created = await toPromise(
			createActor(records.notes.create, {
				input: {
					attempt: {
						operationId: noteId,
						workspaceId: noteId,
						membershipId: noteId,
						draft: { id: noteId, libraryId: owner, articleId: result.operationId }
					}
				}
			}).start()
		)
		if (created.settlement.kind !== 'locallyPersisted')
			throw new Error('Expected note entity after upgrade')
		await created.settlement.workspace.global()
		const revisionId = crypto.randomUUID()
		const note = await toPromise(
			createActor(records.notes.stage, {
				input: {
					attempt: {
						operationId: revisionId,
						workspaceId: revisionId,
						membershipId: revisionId,
						draft: {
							id: revisionId,
							libraryId: owner,
							noteId,
							text: 'A note after migration 😀',
							parents: [],
							editedAt: new Date().toISOString()
						}
					}
				}
			}).start()
		)
		if (note.settlement.kind !== 'locallyPersisted')
			throw new Error('Expected note revision after upgrade')
		await note.settlement.workspace.global()
		await context.close()
		context = await createJazzClient({
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
	const oldPermissions = permissionsForSchema(preDiscoveryApp)
	const server = await startLocalJazzServer({
		dataDir: join(dataDir, 'authority'),
		schema: preDiscoveryApp,
		permissions: oldPermissions,
		allowLocalFirstAuth: true
	})
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
	let context: Awaited<ReturnType<typeof createJazzClient>> | undefined
	try {
		await deploy({
			appId: server.appId,
			serverUrl: server.url,
			adminSecret: server.adminSecret,
			schema: preDiscoveryApp,
			permissions: oldPermissions
		})
		context = await createJazzClient({
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
			permissions: permissionsForSchema(preReaderApp),
			migration: discoveryMigration
		})
		context = await createJazzClient({
			...config,
			app: preReaderApp,
			permissions: permissionsForSchema(preReaderApp),
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
			permissions: permissionsForSchema(preImageApp),
			migration: readerMigration
		})
		context = await createJazzClient({
			...config,
			app: preImageApp,
			permissions: permissionsForSchema(preImageApp),
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
			permissions: permissionsForSchema(preNotesApp),
			migration: imageMigration
		})
		await deploy({
			appId: server.appId,
			serverUrl: server.url,
			adminSecret: server.adminSecret,
			schema: preEntitiesApp,
			permissions: permissionsForSchema(preEntitiesApp),
			migration: noteMigration
		})
		await deploy({
			appId: server.appId,
			serverUrl: server.url,
			adminSecret: server.adminSecret,
			schema: app,
			permissions,
			migration: entityMigration
		})
		context = await createJazzClient({
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

it('imports article-keyed note history into one independent entity without losing versions or replaying imports', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'clipper-note-entity-upgrade-'))
	const server = await startLocalJazzServer({
		dataDir: join(directory, 'authority'),
		schema: preEntitiesApp,
		permissions: preEntityPermissions,
		allowLocalFirstAuth: true
	})
	let identity: string | null = null
	const store = {
		read: async () => identity,
		update: async (transform: (value: string | null) => string) => {
			identity = transform(identity)
		}
	}
	const config = {
		appId: server.appId,
		serverUrl: server.url,
		driver: { type: 'persistent' as const, dataPath: join(directory, 'replica') },
		env: 'test' as const,
		initial: 'local-first' as const,
		store
	}
	let context: Awaited<ReturnType<typeof createJazzClient>> | undefined
	try {
		await deploy({
			appId: server.appId,
			serverUrl: server.url,
			adminSecret: server.adminSecret,
			schema: preEntitiesApp,
			permissions: preEntityPermissions
		})
		context = await createJazzClient({
			...config,
			app: preEntitiesApp,
			permissions: preEntityPermissions
		})
		const owner = context.getSnapshot().account!.id,
			db = context.getSnapshot().client!.db,
			articleId = crypto.randomUUID()
		await db
			.insert(preEntitiesApp.libraries, { ownerId: owner, bootstrapVersion: '1' }, { id: owner })
			.wait({ tier: 'global' })
		await db
			.insert(
				preEntitiesApp.articles,
				{
					libraryId: owner,
					url: 'https://example.com/note-entity-upgrade',
					originalSavedAt: '2026-11-06T00:00:00.000Z',
					contentId: null,
					operationId: null,
					failure: null
				},
				{ id: articleId }
			)
			.wait({ tier: 'global' })
		const baseId = crypto.randomUUID(),
			branchId = crypto.randomUUID(),
			otherId = crypto.randomUUID()
		const originals = [
			{ id: baseId, text: '  Original <b>😀</b>\n', parents: [] },
			{ id: branchId, text: '', parents: [baseId] },
			{ id: otherId, text: 'other offline version', parents: [baseId] }
		]
		for (const { id, text, parents } of originals)
			await db
				.insert(
					preEntitiesApp.articleNoteRevisions,
					{
						libraryId: owner,
						articleId,
						articleParentId: articleId,
						documentParentId: null,
						text,
						parents: JSON.stringify(parents),
						editedAt: '2026-11-06T00:00:00.000Z'
					},
					{ id }
				)
				.wait({ tier: 'global' })
		await context.close()
		context = undefined
		await deploy({
			appId: server.appId,
			serverUrl: server.url,
			adminSecret: server.adminSecret,
			schema: app,
			permissions,
			migration: entityMigration
		})
		context = await createJazzClient({ ...config, app, permissions })
		const records = createLibraryRecords(context.getSnapshot().client!.db, owner, () => true)
		await expect.poll(async () => (await records.notes.legacy()).length).toBe(3)
		const noteId = crypto.randomUUID(),
			draft = { id: noteId, libraryId: owner, articleId }
		const imported = await toPromise(
			createActor(records.notes.importLegacy, {
				input: {
					attempt: { operationId: noteId, workspaceId: noteId, membershipId: noteId, draft }
				}
			}).start()
		)
		if (imported.settlement.kind !== 'locallyPersisted') throw new Error('Expected note import')
		await imported.settlement.workspace.global()
		expect(await records.notes.read(noteId)).toEqual({
			id: noteId,
			libraryId: owner,
			articleId,
			documentId: null
		})
		expect((await records.notes.content(noteId)).versions.map((row) => row.text).sort()).toEqual([
			'',
			'other offline version'
		])
		expect((await records.notes.legacy()).map((row) => row.id).sort()).toEqual(
			originals.map((row) => row.id).sort()
		)
		for (const original of originals) {
			expect(
				await records.notes.readRevision({
					...original,
					libraryId: owner,
					noteId,
					editedAt: '2026-11-06T00:00:00.000Z'
				})
			).toMatchObject(original)
		}
		const repeated = await toPromise(
			createActor(records.notes.importLegacy, {
				input: {
					attempt: { operationId: noteId, workspaceId: noteId, membershipId: noteId, draft }
				}
			}).start()
		)
		expect(repeated.outcome).toBe('blocked')
		expect(await records.notes.forArticle(articleId)).toHaveLength(1)
		await context.close()
		context = await createJazzClient({ ...config, app, permissions })
		const reopened = createLibraryRecords(context.getSnapshot().client!.db, owner, () => true)
		expect((await reopened.notes.content(noteId)).conflicted).toBe(true)
		expect((await reopened.notes.forArticle(articleId))[0]?.id).toBe(noteId)
	} finally {
		await context?.close()
		await server.stop()
		await rm(directory, { recursive: true, force: true })
	}
}, 30000)
