import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createActor, toPromise } from 'xstate'
import { createJazzSession } from 'jazz-tools/backend'
import { ReadTier } from 'jazz-tools'
import { app } from './schema.js'
import permissions from './permissions.js'
import { noteAttempt } from './note-attempt.test-support.js'
import { createLibraryRecords } from './records.js'

it('compiles the actual native policies and reopens locally durable notes without a sync server', async () => {
	const dataPath = await mkdtemp(join(tmpdir(), 'clipper-note-offline-'))
	let identity: string | null = null
	const config = {
		app,
		permissions,
		appId: crypto.randomUUID(),
		serverUrl: 'http://127.0.0.1:1',
		driver: { type: 'persistent' as const, dataPath },
		env: 'test' as const,
		initial: 'local-first' as const,
		store: {
			read: async () => identity,
			update: async (transform: (current: string | null) => string) => {
				identity = transform(identity)
			}
		}
	}
	let session: Awaited<ReturnType<typeof createJazzSession>> | undefined
	try {
		session = await createJazzSession(config)
		const owner = session.getSnapshot().account!.id
		const db = session.getSnapshot().client!.db
		await db.disconnect()
		await db
			.insert(app.libraries, { ownerId: owner, bootstrapVersion: '1' }, { id: owner })
			.wait({ tier: 'local' })
		const records = createLibraryRecords(db, owner, () => true)
		const article = await toPromise(
			createActor(records.articles.saveMachine, {
				input: { url: 'https://example.com/offline-note' }
			}).start()
		)
		if (article.kind !== 'saved') throw new Error('Expected local article')
		const noteId = crypto.randomUUID()
		const entity = { id: noteId, libraryId: owner, articleId: article.operationId }
		const created = await toPromise(
			createActor(records.notes.create, { input: noteAttempt(entity) }).start()
		)
		expect(created.settlement.kind).toBe('locallyPersisted')
		expect(noteId).not.toBe(article.operationId)
		const id = crypto.randomUUID()
		const draft = {
			id,
			libraryId: owner,
			noteId,
			text: 'Offline note 😀',
			parents: [],
			editedAt: new Date().toISOString()
		}
		const note = await toPromise(
			createActor(records.notes.stage, {
				input: { attempt: { operationId: id, workspaceId: id, membershipId: id, draft } }
			}).start()
		)
		expect(note.settlement.kind).toBe('locallyPersisted')
		expect(
			await db.one(app.noteRevisions.where({ id }), { tier: ReadTier.LocalFirst })
		).toMatchObject({
			noteId
		})
		const documentId = crypto.randomUUID()
		const document = await toPromise(
			createActor(records.saveMachine, {
				input: {
					operationId: documentId,
					title: 'Legacy article',
					text: 'Legacy readable text',
					bytes: new TextEncoder().encode('Legacy readable text'),
					mediaType: 'text/plain'
				}
			}).start()
		)
		expect(document.kind).toBe('saved')
		const documentNoteId = crypto.randomUUID()
		const documentEntity = { id: documentNoteId, libraryId: owner, articleId: documentId }
		const createdDocumentNote = await toPromise(
			createActor(records.notes.create, { input: noteAttempt(documentEntity) }).start()
		)
		expect(createdDocumentNote.settlement.kind).toBe('locallyPersisted')
		expect(await records.notes.read(documentNoteId)).toMatchObject({
			id: documentNoteId,
			articleId: null,
			documentId
		})
		const legacyId = crypto.randomUUID()
		const legacy = { ...draft, id: legacyId, noteId: documentNoteId, text: 'Legacy note' }
		const legacyNote = await toPromise(
			createActor(records.notes.stage, {
				input: {
					attempt: {
						operationId: legacyId,
						workspaceId: legacyId,
						membershipId: legacyId,
						draft: legacy
					}
				}
			}).start()
		)
		expect(legacyNote.settlement.kind).toBe('locallyPersisted')
		expect(
			await db.one(app.noteRevisions.where({ id: legacyId }), { tier: ReadTier.LocalFirst })
		).toMatchObject({
			noteId: documentNoteId
		})
		await session.close()
		session = await createJazzSession(config)
		await session.getSnapshot().client!.db.disconnect()
		expect(session.getSnapshot().account!.id).toBe(owner)
		const reopened = createLibraryRecords(session.getSnapshot().client!.db, owner, () => true)
		expect(await reopened.notes.read(noteId)).toMatchObject({
			id: noteId,
			articleId: article.operationId,
			documentId: null
		})
		expect(await reopened.notes.readRevision(draft)).toEqual(draft)
		expect(await reopened.notes.readRevision(legacy)).toEqual(legacy)
	} finally {
		await session?.close()
		await rm(dataPath, { recursive: true, force: true })
	}
})
