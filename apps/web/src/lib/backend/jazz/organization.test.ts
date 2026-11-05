import { beforeAll, afterAll, expect, it } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'
import { createLibraryRecords } from './records.js'
import { organizationOperationSchema, projectOrganization } from '../../capture/organization.js'
import type { OrganizationRequest } from '../../capture/organization.js'
let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
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
	const records = createLibraryRecords(db, id, () => true)
	const result = await toPromise(
		createActor(records.articles.saveMachine, {
			input: { url: `https://example.com/${name}` }
		}).start()
	)
	if (result.kind !== 'saved') throw new Error('Expected article')
	await Promise.all(result.receipts.map((r) => r.global()))
	return { db, id, records, articleId: result.operationId }
}
it('persists desired values in native transactions, preserves other fields, and denies foreign reads/writes and edits to history', async () => {
	const a = await owner('organization-owner'),
		b = await owner('organization-foreign')
	const change = async (request: OrganizationRequest) => {
		const result = await toPromise(
			createActor(a.records.articles.organization.machine, { input: request }).start()
		)
		expect(result.kind).toBe('saved')
		if (result.kind !== 'saved') throw new Error('Expected persisted organization')
		await Promise.all(result.receipts.map((r) => r.global()))
	}
	await change({ id: a.articleId, field: 'favorite', value: true })
	await change({ id: a.articleId, field: 'status', value: 'later' })
	await change({ id: a.articleId, field: 'status', value: 'archive' })
	const rows = await a.db.all(app.organizationOperations.where({ libraryId: a.id }))
	expect(rows).toHaveLength(3)
	const projected = projectOrganization(
		[
			{
				id: a.articleId,
				title: 'article',
				url: null,
				contentId: null,
				originalSavedAt: '',
				failure: null
			}
		],
		rows.map((r) => organizationOperationSchema.parse(r))
	)
	expect(projected[0]).toMatchObject({ status: 'archive', favorite: true })
	expect(await b.db.all(app.organizationOperations.where({ libraryId: a.id }))).toEqual([])
	const first = rows[0]
	if (!first) throw new Error('Expected operation')
	await expect(
		b.db
			.insert(app.organizationOperations, {
				libraryId: a.id,
				articleId: a.articleId,
				documentId: null,
				field: 'favorite',
				value: 'false',
				parents: '[]'
			})
			.wait({ tier: 'global' })
	).rejects.toThrow(/denied|rejected/i)
	await expect(
		a.db.update(app.organizationOperations, first.id, { value: 'false' }).wait({ tier: 'global' })
	).rejects.toThrow(/denied|rejected/i)
	await expect(
		a.db
			.insert(app.organizationOperations, {
				libraryId: a.id,
				articleId: b.articleId,
				documentId: null,
				field: 'status',
				value: 'later',
				parents: '[]'
			})
			.wait({ tier: 'global' })
	).rejects.toThrow(/denied|rejected/i)
	await expect(
		a.db
			.insert(app.organizationOperations, {
				libraryId: a.id,
				articleId: a.articleId,
				documentId: null,
				field: 'status',
				value: 'trash',
				parents: '[]'
			})
			.wait({ tier: 'global' })
	).rejects.toThrow(/denied|rejected/i)
})
it('blocks missing parents without issuing an operation', async () => {
	const a = await owner('organization-missing')
	const result = await toPromise(
		createActor(a.records.articles.organization.machine, {
			input: { id: crypto.randomUUID(), field: 'status', value: 'later' }
		}).start()
	)
	expect(result.kind).toBe('failed')
	expect(await a.db.all(app.organizationOperations.where({ libraryId: a.id }))).toEqual([])
})
