import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'
import { createLibraryRecords } from './records.js'
import { projectArticleNote, storedArticleNoteHistorySchema } from '../../notes/schema.js'
import type { ArticleNoteRevision } from '../../notes/schema.js'
let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterAll(async () => fixture?.shutdown())
async function owner(name: string) {
	const session = { user_id: name, authMode: 'local-first', claims: {} } satisfies PolicyTestSession
	const db = fixture.as(session),
		libraryId = fixture.accountFor(session)
	await db
		.upsert(app.libraries, libraryId, { ownerId: libraryId, bootstrapVersion: '1' })
		.wait({ tier: 'global' })
	const records = createLibraryRecords(db, libraryId, () => true)
	const saved = await toPromise(
		createActor(records.articles.saveMachine, {
			input: { url: `https://example.com/${name}` }
		}).start()
	)
	if (saved.kind !== 'saved') throw new Error('Expected article save')
	await Promise.all(saved.receipts.map((receipt) => receipt.global()))
	return { db, libraryId, records, articleId: saved.operationId }
}
function revision(
	account: Awaited<ReturnType<typeof owner>>,
	text: string,
	parents: string[] = []
): ArticleNoteRevision {
	return {
		libraryId: account.libraryId,
		articleId: account.articleId,
		id: crypto.randomUUID(),
		text,
		parents,
		editedAt: new Date().toISOString()
	}
}
async function write(account: Awaited<ReturnType<typeof owner>>, draft: ArticleNoteRevision) {
	const result = await toPromise(
		createActor(account.records.notes.stage, {
			input: {
				attempt: { operationId: draft.id, workspaceId: draft.id, membershipId: draft.id, draft }
			}
		}).start()
	)
	if (result.settlement.kind === 'locallyPersisted') await result.settlement.workspace.global()
	return result
}
it('preserves concurrent versions, empty edits and explicit reconciliation in private immutable native history', async () => {
	const a = await owner('notes-owner'),
		b = await owner('notes-other')
	const base = revision(a, 'base'),
		first = revision(a, 'device A', [base.id]),
		second = revision(a, 'device B', [base.id])
	for (const draft of [base, first, second])
		expect((await write(a, draft)).settlement.kind).toBe('locallyPersisted')
	const clear = revision(a, '', [first.id])
	await write(a, clear)
	const rows = storedArticleNoteHistorySchema.parse(
		await a.db.all(app.articleNoteRevisions.where({ libraryId: a.libraryId }))
	)
	const note = projectArticleNote(a, rows)
	expect(note.conflicted).toBe(true)
	expect(note.versions.map((version) => version.text).sort()).toEqual(['', 'device B'])
	const resolved = revision(
		a,
		'retained',
		note.heads.map((head) => head.id)
	)
	await write(a, resolved)
	expect(await a.records.notes.readRevision(resolved)).toEqual(resolved)
	await expect(
		a.records.notes.readRevision({ ...resolved, text: 'different intent' })
	).rejects.toThrow('Invalid note operation')
	expect((await write(a, resolved)).outcome).toBe('blocked')
	expect(await b.db.all(app.articleNoteRevisions.where({ libraryId: a.libraryId }))).toEqual([])
	await expect(
		a.db.update(app.articleNoteRevisions, base.id, { text: 'overwrite' }).wait({ tier: 'global' })
	).rejects.toThrow()
	await expect(
		a.db.delete(app.articleNoteRevisions, base.id).wait({ tier: 'global' })
	).rejects.toThrow()
	await expect(
		b.db
			.insert(app.articleNoteRevisions, {
				libraryId: b.libraryId,
				articleId: a.articleId,
				articleParentId: a.articleId,
				documentParentId: null,
				text: 'foreign',
				parents: '[]',
				editedAt: new Date().toISOString()
			})
			.wait({ tier: 'global' })
	).rejects.toThrow()
	await expect(
		b.db
			.insert(app.articleNoteRevisions, {
				libraryId: a.libraryId,
				articleId: a.articleId,
				articleParentId: a.articleId,
				documentParentId: null,
				text: 'foreign owner',
				parents: '[]',
				editedAt: new Date().toISOString()
			})
			.wait({ tier: 'global' })
	).rejects.toThrow()
})
it('blocks missing parents, cross-note causal references and mismatched operation identity inside the transaction', async () => {
	const a = await owner('notes-validation'),
		b = await owner('notes-validation-other')
	const base = revision(a, 'base')
	await write(a, base)
	for (const draft of [
		{ ...revision(a, 'missing'), articleId: crypto.randomUUID() },
		revision(a, 'missing base', [crypto.randomUUID()]),
		revision(b, 'different note', [base.id]),
		{ ...revision(a, 'wrong scope'), libraryId: b.libraryId }
	])
		expect((await write(a, draft)).settlement.kind).not.toBe('locallyPersisted')
	const operationId = crypto.randomUUID()
	const mismatched = await toPromise(
		createActor(a.records.notes.stage, {
			input: {
				attempt: {
					operationId,
					workspaceId: operationId,
					membershipId: operationId,
					draft: revision(a, 'mismatch')
				}
			}
		}).start()
	)
	expect(mismatched.settlement.kind).toBe('notStarted')
	expect(await a.db.all(app.articleNoteRevisions.where({ libraryId: a.libraryId }))).toHaveLength(1)
})
it('carries a legacy document note into the modern URL article', async () => {
	const a = await owner('notes-alias'),
		documentId = crypto.randomUUID()
	const saved = await toPromise(
		createActor(a.records.saveMachine, {
			input: {
				operationId: documentId,
				title: 'Legacy document',
				text: 'Readable text',
				bytes: new TextEncoder().encode('Readable text'),
				mediaType: 'text/plain'
			}
		}).start()
	)
	if (saved.kind !== 'saved') throw new Error('Expected legacy document')
	await Promise.all(saved.receipts.map((receipt) => receipt.global()))
	const legacy = { ...revision(a, 'legacy note'), articleId: documentId }
	expect((await write(a, legacy)).settlement.kind).toBe('locallyPersisted')
	await a.db.update(app.articles, a.articleId, { contentId: documentId }).wait({ tier: 'global' })
	const modern = revision(a, 'edited through article', [legacy.id])
	expect((await write(a, modern)).settlement.kind).toBe('locallyPersisted')
	const aliases = await a.records.notes.targets(a.articleId)
	expect(new Set(aliases)).toEqual(new Set([a.articleId, documentId]))
	const rows = storedArticleNoteHistorySchema.parse(
		await a.db.all(app.articleNoteRevisions.where({ libraryId: a.libraryId }))
	)
	expect(projectArticleNote(a, rows, new Set(aliases)).heads).toEqual([modern])
})
it('fails the whole subscription batch on invalid stored note text or parents', async () => {
	const a = await owner('notes-invalid'),
		next = vi.fn(),
		error = vi.fn()
	const stop = a.records.notes.subscribe(next, error)
	await expect.poll(() => next.mock.calls.length).toBeGreaterThan(0)
	const count = next.mock.calls.length
	await a.db
		.insert(app.articleNoteRevisions, {
			libraryId: a.libraryId,
			articleId: a.articleId,
			articleParentId: a.articleId,
			documentParentId: null,
			text: 'private',
			parents: 'invalid',
			editedAt: new Date().toISOString()
		})
		.wait({ tier: 'global' })
	await expect.poll(() => error.mock.calls.length).toBeGreaterThan(0)
	expect(next.mock.calls.length).toBe(count)
	stop()
})

it('rejects native note inserts without exactly one same-library parent reference', async () => {
	const a = await owner('notes-parent-references')
	for (const refs of [
		{ articleParentId: null, documentParentId: null },
		{ articleParentId: a.articleId, documentParentId: a.articleId },
		{ articleParentId: crypto.randomUUID(), documentParentId: null },
		{ articleParentId: null, documentParentId: a.articleId }
	]) {
		await expect(
			a.db
				.insert(app.articleNoteRevisions, {
					libraryId: a.libraryId,
					articleId: a.articleId,
					text: 'invalid reference',
					parents: '[]',
					editedAt: new Date().toISOString(),
					...refs
				})
				.wait({ tier: 'global' })
		).rejects.toThrow(/denied|rejected/i)
	}
})
