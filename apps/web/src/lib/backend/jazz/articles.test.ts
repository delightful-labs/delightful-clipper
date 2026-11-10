import { policySchema } from './schema-permissions.test-support.js'
import { beforeAll, afterAll, expect, it } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'
import { createLibraryRecords } from './records.js'
import { articleId } from '../../capture/source.js'
import { readRecord } from '../../machines/storage/read.test-support.js'
let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(policySchema(), permissions, expect)
})
afterAll(async () => {
	await fixture?.shutdown()
})
async function owner(name: string) {
	const session = { user_id: name, authMode: 'local-first', claims: {} } satisfies PolicyTestSession
	const db = fixture.as(session),
		id = fixture.accountFor(session)
	await db
		.upsert(app.libraries, id, { ownerId: id, bootstrapVersion: '1' })
		.wait({ tier: 'global' })
	return { db, id, records: createLibraryRecords(db, id, () => true) }
}
const url = 'https://short.example/article?b=2&a=1#note'
const content = {
	title: 'Saved article',
	text: 'Exact text café 🦊',
	html: '<p>Exact text café 🦊</p>',
	finalUrl: 'https://example.com/article',
	provenance: '{}'
}
it('persists an article with only its URL and metadata, without fake content or a capture record', async () => {
	const a = await owner('article-url')
	const result = await toPromise(
		createActor(a.records.articles.saveMachine, { input: { url } }).start()
	)
	expect(result.kind).toBe('saved')
	if (result.kind !== 'saved') throw new Error('Expected save')
	await Promise.all(result.receipts.map((r) => r.global()))
	expect(await a.records.articles.read(result.operationId)).toMatchObject({
		url,
		contentId: null,
		operationId: null,
		failure: null
	})
	expect(await a.db.all(app.documents.where({ libraryId: a.id }))).toEqual([])
	expect(await a.db.all(app.storageOperations.where({ libraryId: a.id }))).toEqual([])
})
it('the same save operation accepts content and completes the original article without replacing snapshots', async () => {
	const a = await owner('article-content')
	const first = await toPromise(
		createActor(a.records.articles.saveMachine, { input: { url } }).start()
	)
	const before = await a.records.articles.read(first.operationId)
	const saved = await toPromise(
		createActor(a.records.articles.saveMachine, { input: { url, content } }).start()
	)
	expect(saved.kind).toBe('saved')
	if (saved.kind !== 'saved') throw new Error('Expected save')
	await Promise.all(saved.receipts.map((r) => r.global()))
	expect(saved.ready).toBe(true)
	expect(saved.operationId).toBe(first.operationId)
	const row = await a.records.articles.read(saved.operationId)
	expect(row?.originalSavedAt).toBe(before?.originalSavedAt)
	expect(row?.contentId).toBe(await articleId(a.id, content.finalUrl))
	expect(await readRecord(a.records.readCapabilities, saved.operationId)).toMatchObject({
		kind: 'available',
		text: content.text,
		source: { submittedUrl: url }
	})
	const repeat = await toPromise(
		createActor(a.records.articles.saveMachine, {
			input: { url, content: { ...content, text: 'Replacement' } }
		}).start()
	)
	expect(repeat.kind).toBe('duplicate')
	expect(await readRecord(a.records.readCapabilities, saved.operationId)).toMatchObject({
		text: content.text
	})
})
it('saves supplied browser content directly and allows a second URL to reuse the immutable saved content', async () => {
	const a = await owner('article-supplied')
	const result = await toPromise(
		createActor(a.records.articles.saveMachine, { input: { url, content } }).start()
	)
	expect(result.kind).toBe('saved')
	if (result.kind !== 'saved') throw new Error('Expected save')
	await Promise.all(result.receipts.map((r) => r.global()))
	expect(result.ready).toBe(true)
	const second = await toPromise(
		createActor(a.records.articles.saveMachine, { input: { url: content.finalUrl } }).start()
	)
	expect(second.kind).toBe('duplicate')
	expect('ready' in second && second.ready).toBe(true)
	expect(await a.db.all(app.documents.where({ libraryId: a.id }))).toHaveLength(1)
})
it('keeps a pending article and blocks replay when an earlier publication intent is stranded', async () => {
	const a = await owner('article-unknown')
	const initial = await toPromise(
		createActor(a.records.articles.saveMachine, { input: { url } }).start()
	)
	const target = await articleId(a.id, content.finalUrl)
	await a.db
		.insert(
			app.storageOperations,
			{ libraryId: a.id, payloadHash: 'stranded', createdAt: new Date().toISOString() },
			{ id: target }
		)
		.wait({ tier: 'global' })
	const result = await toPromise(
		createActor(a.records.articles.saveMachine, { input: { url, content } }).start()
	)
	expect(result.kind).toBe('unknown')
	expect(await a.records.articles.read(initial.operationId)).toMatchObject({ contentId: null, url })
	expect(await a.db.all(app.documents.where({ libraryId: a.id }))).toEqual([])
})
it('denies foreign article access and content references, and prevents completed article replacement', async () => {
	const a = await owner('article-a'),
		b = await owner('article-b')
	const saved = await toPromise(
		createActor(a.records.articles.saveMachine, { input: { url, content } }).start()
	)
	if (saved.kind !== 'saved') throw new Error('Expected save')
	await Promise.all(saved.receipts.map((r) => r.global()))
	const row = await a.records.articles.read(saved.operationId)
	if (!row) throw new Error('Missing article')
	expect(await b.records.articles.read(row.id)).toBeNull()
	await expect(
		a.db.update(app.articles, row.id, { contentId: null }).wait({ tier: 'global' })
	).rejects.toThrow(/denied|rejected/i)
	await expect(
		b.db
			.insert(app.articles, {
				libraryId: b.id,
				url,
				originalSavedAt: row.originalSavedAt,
				contentId: row.contentId,
				operationId: null,
				failure: null
			})
			.wait({ tier: 'global' })
	).rejects.toThrow(/denied|rejected/i)
})
