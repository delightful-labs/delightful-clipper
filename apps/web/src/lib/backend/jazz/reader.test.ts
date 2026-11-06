import { beforeAll, afterAll, expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'
import { createLibraryRecords } from './records.js'
import { readerHistorySchema, projectReaderState } from '../../reader/schema.js'
import type { ReaderChange } from '../../reader/schema.js'
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
	const records = createLibraryRecords(db, id, () => true),
		documentId = crypto.randomUUID()
	const saved = await toPromise(
		createActor(records.saveMachine, {
			input: {
				operationId: documentId,
				title: 'Reading fixture',
				text: 'Readable content',
				bytes: new TextEncoder().encode('Readable content'),
				mediaType: 'text/plain'
			}
		}).start()
	)
	if (saved.kind !== 'saved') throw new Error('Expected saved content')
	await Promise.all(saved.receipts.map((receipt) => receipt.global()))
	return { db, id, records, documentId }
}
async function change(account: Awaited<ReturnType<typeof owner>>, draft: ReaderChange) {
	const operationId = crypto.randomUUID()
	const observed = readerHistorySchema.parse(
		await account.db.all(app.readerOperations.where({ libraryId: account.id }))
	)
	const result = await toPromise(
		createActor(account.records.reader.stage(observed), {
			input: {
				attempt: { operationId, workspaceId: operationId, membershipId: operationId, draft }
			}
		}).start()
	)
	if (result?.settlement.kind !== 'locallyPersisted')
		throw new Error('Expected local reading write')
	await result.settlement.workspace.global()
	return operationId
}
it('persists independent reading fields and causally ordered positions with private immutable native history', async () => {
	const a = await owner('reader-owner'),
		b = await owner('reader-foreign')
	const first = await change(a, { documentId: null, field: 'theme', value: 'dark' })
	await change(a, { documentId: null, field: 'size', value: 24 })
	await change(a, { documentId: null, field: 'theme', value: 'light' })
	const pos = {
		version: 1 as const,
		offset: 5,
		quote: 'able',
		prefix: 'Read',
		suffix: ' content',
		progress: 0.5,
		interactedAt: new Date().toISOString()
	}
	await change(a, { documentId: a.documentId, field: 'position', value: pos })
	const rows = await a.db.all(app.readerOperations.where({ libraryId: a.id }))
	const state = projectReaderState(readerHistorySchema.parse(rows))
	expect(state.preferences).toMatchObject({ theme: 'light', size: 24 })
	expect(state.positions[a.documentId]).toEqual(pos)
	expect(rows.find((row) => row.field === 'theme' && row.value === '"light"')?.parents).toBe(
		JSON.stringify([first])
	)
	expect(await b.db.all(app.readerOperations.where({ libraryId: a.id }))).toEqual([])
	await expect(
		a.db.update(app.readerOperations, first, { value: '"system"' }).wait({ tier: 'global' })
	).rejects.toThrow(/denied|rejected/i)
	await expect(a.db.delete(app.readerOperations, first).wait({ tier: 'global' })).rejects.toThrow(
		/denied|rejected/i
	)
	await expect(
		b.db
			.insert(app.readerOperations, {
				libraryId: b.id,
				documentId: a.documentId,
				field: 'position',
				value: JSON.stringify(pos),
				parents: '[]'
			})
			.wait({ tier: 'global' })
	).rejects.toThrow(/denied|rejected/i)
	await expect(
		b.db
			.insert(app.readerOperations, {
				libraryId: a.id,
				documentId: null,
				field: 'theme',
				value: '"dark"',
				parents: '[]'
			})
			.wait({ tier: 'global' })
	).rejects.toThrow(/denied|rejected/i)
})
it('blocks missing reading parents and rejects invalid commands before staging any row', async () => {
	const a = await owner('reader-missing'),
		operationId = crypto.randomUUID()
	const result = await toPromise(
		createActor(a.records.reader.stage([]), {
			input: {
				attempt: {
					operationId,
					workspaceId: operationId,
					membershipId: operationId,
					draft: {
						documentId: crypto.randomUUID(),
						field: 'position',
						value: {
							version: 1,
							offset: 0,
							quote: 'read',
							prefix: '',
							suffix: '',
							progress: 0,
							interactedAt: new Date().toISOString()
						}
					}
				}
			}
		}).start()
	)
	expect(result?.settlement.kind).not.toBe('locallyPersisted')
	expect(await a.db.all(app.readerOperations.where({ libraryId: a.id }))).toEqual([])
})
it('rejects an invalid observed batch without publishing partial reading state', async () => {
	const a = await owner('reader-invalid-observation'),
		next = vi.fn(),
		error = vi.fn()
	const dispose = a.records.reader.capability.subscribe(next, error)
	await expect.poll(() => next.mock.calls.length).toBeGreaterThan(0)
	const before = next.mock.calls.length
	await a.db
		.insert(app.readerOperations, {
			libraryId: a.id,
			documentId: null,
			field: 'size',
			value: '"invalid"',
			parents: '[]'
		})
		.wait({ tier: 'global' })
	await expect.poll(() => error.mock.calls.length).toBeGreaterThan(0)
	expect(next.mock.calls.length).toBe(before)
	dispose()
})
