import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'
import { createFakeDataRecords } from './fake-data.js'
import { createLibraryRecords } from './records.js'
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
	return { db, id }
}
function seed(
	db: Parameters<typeof createFakeDataRecords>[0],
	id: string,
	enabled = true,
	current = () => true
) {
	return createActor(createFakeDataRecords(db, id, current)(enabled)).start()
}
it('seeds complete private native records and independent metadata once, including readers', async () => {
	const { db, id } = await owner('fake-complete')
	expect(await toPromise(seed(db, id))).toBe('seeded')
	const articles = await db.all(app.articles.where({ libraryId: id }))
	expect(articles).toHaveLength(24)
	expect(await db.all(app.documents.where({ libraryId: id }))).toHaveLength(24)
	expect(await db.all(app.tagOperations.where({ libraryId: id }))).toHaveLength(24)
	expect(await db.all(app.organizationOperations.where({ libraryId: id }))).toHaveLength(72)
	const first = articles[0]
	if (!first) throw new Error('Missing seeded article')
	const records = createLibraryRecords(db, id, () => true)
	expect((await records.readCapabilities.document(first.id))?.title).toBeTruthy()
	expect(await toPromise(seed(db, id))).toBe('skipped')
	expect(await db.all(app.articles.where({ libraryId: id }))).toHaveLength(24)
})
it('does no reads or writes when disabled or scope has expired', async () => {
	const { db, id } = await owner('fake-disabled')
	const read = vi.spyOn(db, 'all'),
		open = vi.spyOn(db, 'beginExclusiveTransaction')
	expect(await toPromise(seed(db, id, false))).toBe('skipped')
	expect(await toPromise(seed(db, id, true, () => false))).toBe('skipped')
	expect(read).not.toHaveBeenCalled()
	expect(open).not.toHaveBeenCalled()
})
it('preserves existing native URL-only data', async () => {
	const { db, id } = await owner('fake-existing')
	const records = createLibraryRecords(db, id, () => true)
	await toPromise(
		createActor(records.articles.saveMachine, {
			input: { url: 'https://example.com/real' }
		}).start()
	)
	expect(await toPromise(seed(db, id))).toBe('skipped')
	expect(await db.all(app.articles.where({ libraryId: id }))).toHaveLength(1)
})
it('rechecks under the exclusive transaction so racing seeders do not duplicate or overwrite', async () => {
	const { db, id } = await owner('fake-race')
	const results = await Promise.all([toPromise(seed(db, id)), toPromise(seed(db, id))])
	expect(results).toContain('seeded')
	expect(await db.all(app.articles.where({ libraryId: id }))).toHaveLength(24)
	expect(await db.all(app.documents.where({ libraryId: id }))).toHaveLength(24)
})
it('does not seed or disclose another account library', async () => {
	const a = await owner('fake-private'),
		b = await owner('fake-stranger')
	expect(await toPromise(seed(a.db, a.id))).toBe('seeded')
	expect(await toPromise(seed(b.db, a.id))).toBe('skipped')
	expect(await b.db.all(app.articles.where({ libraryId: a.id }))).toHaveLength(0)
})
it('drains an issued exclusive settlement on shutdown without replaying it', async () => {
	const { db, id } = await owner('fake-drain')
	const released = Promise.withResolvers<void>(),
		entered = Promise.withResolvers<void>()
	const begin = db.beginExclusiveTransaction.bind(db)
	vi.spyOn(db, 'beginExclusiveTransaction').mockImplementation(() => {
		const tx = begin(),
			commit = tx.commit.bind(tx)
		vi.spyOn(tx, 'commit').mockImplementation(() => {
			const write = commit(),
				wait = write.wait.bind(write)
			vi.spyOn(write, 'wait').mockImplementation(async () => {
				await wait()
				entered.resolve()
				await released.promise
			})
			return write
		})
		return tx
	})
	const actor = seed(db, id)
	await entered.promise
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().status).toBe('active')
	released.resolve()
	expect(await toPromise(actor)).toBe('closed')
	expect(await db.all(app.articles.where({ libraryId: id }))).toHaveLength(24)
})
