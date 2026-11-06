import { beforeAll, afterAll, expect, it } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'
import { createLibraryRecords } from './records.js'
import { imageRowSchema } from '../../images/schema.js'
import type { ImageWrite } from '../../images/schema.js'
let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterAll(async () => fixture?.shutdown())
const bytes = new Uint8Array(
	Buffer.from(
		'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
		'base64'
	)
)
async function owner(name: string) {
	const session = { user_id: name, authMode: 'local-first', claims: {} } satisfies PolicyTestSession
	const db = fixture.as(session),
		id = fixture.accountFor(session)
	await db
		.upsert(app.libraries, id, { ownerId: id, bootstrapVersion: '1' })
		.wait({ tier: 'global' })
	const records = createLibraryRecords(db, id, () => true),
		documentId = crypto.randomUUID()
	const saved = await toPromise(
		createActor(records.saveMachine, {
			input: {
				operationId: documentId,
				title: 'Image fixture',
				text: 'Readable before images',
				bytes: new TextEncoder().encode(
					'<p>Readable before images</p><img alt="A tiny diagram" data-clipper-image="https%3A%2F%2Fexample.com%2Ftiny.png">'
				),
				mediaType: 'text/html'
			}
		}).start()
	)
	if (saved.kind !== 'saved') throw new Error('Expected text save')
	await Promise.all(saved.receipts.map((receipt) => receipt.global()))
	const rows = await db.all(app.articleImages.where({ libraryId: id }))
	const image = imageRowSchema.parse(rows[0])
	return { db, id, records, documentId, image }
}
async function write(account: Awaited<ReturnType<typeof owner>>, draft: ImageWrite) {
	const stage =
		draft.kind === 'ready' ? account.records.images.ready : account.records.images.failure
	const result = await toPromise(
		createActor(stage, {
			input: {
				attempt: {
					operationId: draft.image.id,
					workspaceId: draft.image.id,
					membershipId: draft.image.id,
					draft
				}
			}
		}).start()
	)
	if (result.settlement.kind === 'locallyPersisted') await result.settlement.workspace.global()
	return result
}
it('declares images with immutable text, saves native bytes independently, and enforces private terminal assets', async () => {
	const a = await owner('images-owner'),
		b = await owner('images-foreign')
	expect(a.image).toMatchObject({ status: 'pending', assetId: null })
	expect(await a.db.one(app.documents.where({ id: a.documentId }))).not.toBeNull()
	expect(await b.db.all(app.articleImages.where({ libraryId: a.id }))).toEqual([])
	const failed = await write(a, { kind: 'failed', image: a.image, retryable: true })
	expect(failed.settlement.kind).toBe('locallyPersisted')
	const result = await write(a, {
		kind: 'ready',
		image: a.image,
		result: { bytes, mediaType: 'image/png', width: 1, height: 1 }
	})
	expect(result.settlement.kind).toBe('locallyPersisted')
	expect(await a.db.one(app.articleImages.where({ id: a.image.id }))).toMatchObject({
		status: 'ready',
		assetId: a.image.id
	})
	expect((await a.db.one(app.assets.where({ id: a.image.id })))?.payload).toEqual(bytes)
	expect(await b.db.one(app.assets.where({ id: a.image.id }))).toBeNull()
	expect((await write(a, { kind: 'failed', image: a.image, retryable: true })).outcome).toBe(
		'blocked'
	)
	expect(
		(
			await write(a, {
				kind: 'ready',
				image: a.image,
				result: { bytes, mediaType: 'image/png', width: 1, height: 1 }
			})
		).outcome
	).toBe('blocked')
	expect(await a.db.all(app.assets.where({ id: a.image.id }))).toHaveLength(1)
	await expect(
		a.db
			.update(app.articleImages, a.image.id, { status: 'failed', assetId: null })
			.wait({ tier: 'global' })
	).rejects.toThrow()
	await expect(
		b.db
			.update(app.articleImages, b.image.id, { status: 'ready', assetId: a.image.id })
			.wait({ tier: 'global' })
	).rejects.toThrow()
	await expect(
		b.db
			.insert(app.articleImages, {
				libraryId: b.id,
				documentId: a.documentId,
				sourceUrl: 'https://example.com/foreign.png',
				status: 'pending',
				assetId: null,
				retryable: true
			})
			.wait({ tier: 'global' })
	).rejects.toThrow()
})
