import { afterAll, beforeAll, expect, it } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp } from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'
import { createLibraryRecords } from './records.js'
import { BYTE_LIMIT, prepareSave } from '../../storage/codec.js'

let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterAll(async () => {
	await fixture?.shutdown()
})
function randomBytes(size: number) {
	const bytes = new Uint8Array(size)
	for (let i = 0; i < size; i += 65536)
		crypto.getRandomValues(bytes.subarray(i, Math.min(i + 65536, size)))
	return bytes
}
async function owner(name: string) {
	const session = {
		user_id: name,
		authMode: 'local-first',
		claims: {}
	} satisfies import('jazz-tools/testing').PolicyTestSession
	const db = fixture.as(session),
		id = fixture.accountFor(session)
	await db
		.upsert(app.libraries, id, { ownerId: id, bootstrapVersion: '1' })
		.wait({ tier: 'global' })
	return { db, id, store: createLibraryRecords(db, id, () => true) }
}
function request(bytes = new Uint8Array([7, 8, 9, 10])) {
	return {
		operationId: crypto.randomUUID(),
		title: 'Stored text',
		text: 'A literal <script> is text.\nUnicode: café 🦊',
		bytes,
		mediaType: 'application/octet-stream'
	}
}
it('publishes text and multiple verified byte parts only after local persistence', async () => {
	const { db, store } = await owner('records-owner')
	const input = request(randomBytes(600 * 1024))
	const result = await toPromise(createActor(store.saveMachine, { input }).start())
	expect(result.kind).toBe('saved')
	if (result.kind !== 'saved') throw new Error('Expected local save')
	await Promise.all(result.receipts.map((receipt) => receipt.global()))
	expect(await db.all(app.blobParts.where({ manifestId: input.operationId }))).toHaveLength(3)
	const read = await toPromise(
		createActor(store.readMachine, { input: { id: input.operationId } }).start()
	)
	expect(read.kind).toBe('available')
	if (read.kind !== 'available' || read.asset.kind !== 'available')
		throw new Error('Expected locally verified asset')
	expect(read.text).toBe(input.text)
	expect(read.asset.bytes.length).toBe(input.bytes.length)
	expect(read.asset.bytes.every((byte, index) => byte === input.bytes[index])).toBe(true)
	const repeat = await toPromise(createActor(store.saveMachine, { input }).start())
	expect(repeat.kind).toBe('blocked')
	expect(await db.all(app.documents.where({ operationId: input.operationId }))).toHaveLength(1)
})
it('denies foreign reads, forged parents, immutable changes and partial publication', async () => {
	const a = await owner('records-a'),
		b = await owner('records-b')
	const input = request()
	const saved = await toPromise(createActor(a.store.saveMachine, { input }).start())
	if (saved.kind !== 'saved') throw new Error('Expected local save')
	await Promise.all(saved.receipts.map((receipt) => receipt.global()))
	const foreignRows = await Promise.all([
		b.db.one(app.documents.where({ id: input.operationId })),
		b.db.one(app.snapshots.where({ id: input.operationId })),
		b.db.one(app.blobManifests.where({ id: input.operationId })),
		b.db.one(app.storageOperations.where({ id: input.operationId }))
	])
	for (const row of foreignRows) expect(row).toBeNull()
	expect(await b.db.all(app.blobParts.where({ manifestId: input.operationId }))).toEqual([])
	const deny = /denied|rejected/i
	await expect(
		a.db.update(app.documents, input.operationId, { title: 'Overwrite' }).wait({ tier: 'global' })
	).rejects.toThrow(deny)
	await expect(
		a.db.delete(app.documents, input.operationId).wait({ tier: 'global' })
	).rejects.toThrow(deny)
	await expect(
		b.db
			.insert(app.blobParts, {
				libraryId: b.id,
				manifestId: input.operationId,
				ordinal: 0,
				byteLength: 1,
				hash: 'forged',
				payload: new Uint8Array([1])
			})
			.wait({ tier: 'global' })
	).rejects.toThrow(deny)
	const draft = await prepareSave(a.id, request())
	const tx = a.db.beginTransaction()
	const { id, ...intent } = draft.intent
	tx.insert(app.storageOperations, intent, { id })
	const { id: manifestId, ...manifest } = draft.manifest
	tx.insert(app.blobManifests, { ...manifest, libraryId: b.id }, { id: manifestId })
	await expect(tx.commit().wait({ tier: 'global' })).rejects.toThrow(deny)
	expect(await a.db.one(app.storageOperations.where({ id }))).toBeNull()
})
it('does not publish a complete document from staging metadata alone', async () => {
	const { db, id, store } = await owner('records-staging')
	const draft = await prepareSave(id, request())
	const tx = db.beginTransaction()
	const { id: operationId, ...intent } = draft.intent
	tx.insert(app.storageOperations, intent, { id: operationId })
	const { id: manifestId, ...manifest } = draft.manifest
	tx.insert(app.blobManifests, manifest, { id: manifestId })
	await tx.commit().wait({ tier: 'global' })
	expect(
		(await toPromise(createActor(store.readMachine, { input: { id: operationId } }).start())).kind
	).toBe('missing')
})
it('rejects oversized input before writing an operation journal', async () => {
	const { db, store } = await owner('records-limit')
	const input = request(new Uint8Array(BYTE_LIMIT + 1))
	const result = await toPromise(createActor(store.saveMachine, { input }).start())
	expect(result.kind).toBe('failed')
	expect(await db.one(app.storageOperations.where({ id: input.operationId }))).toBeNull()
})
