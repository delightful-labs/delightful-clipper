import { afterAll, beforeAll, expect, it } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'
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
	const db = fixture.as(session)
	const libraryId = fixture.accountFor(session)
	await db
		.upsert(app.libraries, libraryId, { ownerId: libraryId, bootstrapVersion: '1' })
		.wait({ tier: 'global' })
	return { db, libraryId }
}
function intake(libraryId: string) {
	return {
		libraryId,
		submittedUrl: 'https://short.example/article?b=2&a=1#note',
		fetchUrl: 'https://short.example/article?b=2&a=1',
		createdAt: new Date().toISOString(),
		formatVersion: '1'
	}
}
function observation(libraryId: string, intakeId: string) {
	return {
		libraryId,
		intakeId,
		attemptId: crypto.randomUUID(),
		kind: 'failure',
		payload: JSON.stringify({ code: 'sourceUnavailable', retryable: true }),
		createdAt: new Date().toISOString(),
		formatVersion: '1'
	}
}
async function saveDocument(scope: Awaited<ReturnType<typeof owner>>) {
	const operationId = crypto.randomUUID()
	const records = createLibraryRecords(scope.db, scope.libraryId, () => true)
	const result = await toPromise(
		createActor(records.saveMachine, {
			input: {
				operationId,
				title: 'Immutable article',
				text: 'Previously readable content',
				bytes: new TextEncoder().encode('<p>Previously readable content</p>'),
				mediaType: 'text/html'
			}
		}).start()
	)
	if (result.kind !== 'saved') throw new Error('Expected document save')
	await Promise.all(result.receipts.map((receipt) => receipt.global()))
	return operationId
}
const denied = /denied|rejected/i

it('retains a link and failure evidence without publishing an empty readable document', async () => {
	const { db, libraryId } = await owner('capture-link')
	const intakeId = crypto.randomUUID()
	const submitted = intake(libraryId)
	const write = db.insert(app.captureIntakes, submitted, { id: intakeId })
	await write.wait({ tier: 'local' })
	await write.wait({ tier: 'global' })
	const observationId = crypto.randomUUID()
	const failure = observation(libraryId, intakeId)
	await db.insert(app.captureObservations, failure, { id: observationId }).wait({ tier: 'global' })
	expect(await db.one(app.captureIntakes.where({ id: intakeId }))).toEqual({
		id: intakeId,
		...submitted
	})
	expect(await db.one(app.captureObservations.where({ id: observationId }))).toEqual({
		id: observationId,
		...failure
	})
	expect(await db.all(app.documents.where({ libraryId }))).toEqual([])
	expect(await db.all(app.snapshots.where({ libraryId }))).toEqual([])
	expect(await db.all(app.assets.where({ libraryId }))).toEqual([])
	expect(await db.all(app.storageOperations.where({ libraryId }))).toEqual([])
})

it('records success against the same intake without replacing a prior document or failure', async () => {
	const scope = await owner('capture-completed')
	const { db, libraryId } = scope
	const documentId = await saveDocument(scope)
	const original = await db.one(app.documents.where({ id: documentId }))
	const intakeId = crypto.randomUUID()
	await db.insert(app.captureIntakes, intake(libraryId), { id: intakeId }).wait({ tier: 'global' })
	const failed = observation(libraryId, intakeId)
	await db.insert(app.captureObservations, failed).wait({ tier: 'global' })
	const completionId = crypto.randomUUID()
	const completion = {
		libraryId,
		intakeId,
		attemptId: crypto.randomUUID(),
		documentId,
		createdAt: new Date().toISOString(),
		formatVersion: '1'
	}
	await db.insert(app.captureCompletions, completion, { id: completionId }).wait({ tier: 'global' })
	await expect(
		db
			.insert(app.captureCompletions, { ...completion, formatVersion: '2' })
			.wait({ tier: 'global' })
	).rejects.toThrow(denied)
	await expect(
		db
			.insert(app.captureCompletions, { ...completion, intakeId: crypto.randomUUID() })
			.wait({ tier: 'global' })
	).rejects.toThrow(denied)
	expect(await db.one(app.captureCompletions.where({ id: completionId }))).toEqual({
		id: completionId,
		...completion
	})
	expect(await db.one(app.documents.where({ id: documentId }))).toEqual(original)
	expect(await db.all(app.captureObservations.where({ intakeId }))).toHaveLength(1)
	expect(await db.all(app.captureIntakes.where({ libraryId }))).toHaveLength(1)
	await expect(
		db
			.update(app.captureIntakes, intakeId, { submittedUrl: 'https://changed.example/' })
			.wait({ tier: 'global' })
	).rejects.toThrow(denied)
	const failures = await db.all(app.captureObservations.where({ intakeId }))
	const failureId = failures[0]?.id
	if (!failureId) throw new Error('Missing failure evidence')
	await expect(
		db.update(app.captureObservations, failureId, { payload: '{}' }).wait({ tier: 'global' })
	).rejects.toThrow(denied)
	await expect(
		db
			.update(app.captureCompletions, completionId, { documentId: crypto.randomUUID() })
			.wait({ tier: 'global' })
	).rejects.toThrow(denied)
	for (const write of [
		() => db.delete(app.captureIntakes, intakeId),
		() => db.delete(app.captureObservations, failureId),
		() => db.delete(app.captureCompletions, completionId)
	])
		await expect(write().wait({ tier: 'global' })).rejects.toThrow(denied)
})

it('denies foreign capture reads, owner forgery and cross-library completion parents', async () => {
	const a = await owner('capture-private-a')
	const b = await owner('capture-private-b')
	const intakeId = crypto.randomUUID()
	await a.db
		.insert(app.captureIntakes, intake(a.libraryId), { id: intakeId })
		.wait({ tier: 'global' })
	const observationId = crypto.randomUUID()
	await a.db
		.insert(app.captureObservations, observation(a.libraryId, intakeId), { id: observationId })
		.wait({ tier: 'global' })
	const documentId = await saveDocument(a)
	const completionId = crypto.randomUUID()
	const completion = {
		libraryId: a.libraryId,
		intakeId,
		attemptId: crypto.randomUUID(),
		documentId,
		createdAt: new Date().toISOString(),
		formatVersion: '1'
	}
	await a.db
		.insert(app.captureCompletions, completion, { id: completionId })
		.wait({ tier: 'global' })
	expect(await b.db.one(app.captureIntakes.where({ id: intakeId }))).toBeNull()
	expect(await b.db.one(app.captureObservations.where({ id: observationId }))).toBeNull()
	expect(await b.db.one(app.captureCompletions.where({ id: completionId }))).toBeNull()
	expect(await b.db.all(app.captureIntakes.where({ libraryId: a.libraryId }))).toEqual([])
	expect(await b.db.all(app.captureObservations.where({ libraryId: a.libraryId }))).toEqual([])
	expect(await b.db.all(app.captureCompletions.where({ libraryId: a.libraryId }))).toEqual([])
	await expect(
		b.db.insert(app.captureIntakes, intake(a.libraryId)).wait({ tier: 'global' })
	).rejects.toThrow(denied)
	await expect(
		b.db
			.insert(app.captureObservations, observation(a.libraryId, intakeId))
			.wait({ tier: 'global' })
	).rejects.toThrow(denied)
	await expect(
		b.db.insert(app.captureCompletions, completion).wait({ tier: 'global' })
	).rejects.toThrow(denied)
	await expect(
		b.db
			.insert(app.captureObservations, observation(b.libraryId, intakeId))
			.wait({ tier: 'global' })
	).rejects.toThrow(denied)
	const ownIntakeId = crypto.randomUUID()
	await b.db
		.insert(app.captureIntakes, intake(b.libraryId), { id: ownIntakeId })
		.wait({ tier: 'global' })
	// Foreign intake with an otherwise owned document is also forbidden.
	const ownDocumentId = await saveDocument(b)
	await expect(
		b.db
			.insert(app.captureCompletions, {
				...completion,
				libraryId: b.libraryId,
				documentId: ownDocumentId
			})
			.wait({ tier: 'global' })
	).rejects.toThrow(denied)
	// Owned intake cannot authorize a foreign document.
	await expect(
		b.db
			.insert(app.captureCompletions, {
				...completion,
				libraryId: b.libraryId,
				intakeId: ownIntakeId
			})
			.wait({ tier: 'global' })
	).rejects.toThrow(denied)
})

it('rejects unsupported formats and orphan references, including an atomic forged graph', async () => {
	const { db, libraryId } = await owner('capture-invalid')
	await expect(
		db
			.insert(app.captureIntakes, { ...intake(libraryId), formatVersion: '2' })
			.wait({ tier: 'global' })
	).rejects.toThrow(denied)
	const intakeId = crypto.randomUUID()
	await expect(
		db.insert(app.captureObservations, observation(libraryId, intakeId)).wait({ tier: 'global' })
	).rejects.toThrow(denied)
	await db.insert(app.captureIntakes, intake(libraryId), { id: intakeId }).wait({ tier: 'global' })
	await expect(
		db
			.insert(app.captureObservations, { ...observation(libraryId, intakeId), formatVersion: '2' })
			.wait({ tier: 'global' })
	).rejects.toThrow(denied)
	const completion = {
		libraryId,
		intakeId,
		attemptId: crypto.randomUUID(),
		documentId: crypto.randomUUID(),
		createdAt: new Date().toISOString(),
		formatVersion: '1'
	}
	await expect(
		db.insert(app.captureCompletions, completion).wait({ tier: 'global' })
	).rejects.toThrow(denied)
	const nextIntakeId = crypto.randomUUID()
	const tx = db.beginTransaction()
	tx.insert(app.captureIntakes, intake(libraryId), { id: nextIntakeId })
	tx.insert(app.captureObservations, observation(libraryId, nextIntakeId))
	tx.insert(app.captureCompletions, { ...completion, intakeId: nextIntakeId })
	await expect(tx.commit().wait({ tier: 'global' })).rejects.toThrow(denied)
	expect(await db.one(app.captureIntakes.where({ id: nextIntakeId }))).toBeNull()
	expect(await db.all(app.captureObservations.where({ intakeId: nextIntakeId }))).toEqual([])
})

it('accepts an atomic intake/evidence graph and exposes it to the same account session', async () => {
	const first = await owner('capture-same-account')
	const second = await owner('capture-same-account')
	const documentId = await saveDocument(first)
	const intakeId = crypto.randomUUID()
	const submitted = intake(first.libraryId)
	const failure = observation(first.libraryId, intakeId)
	const completion = {
		libraryId: first.libraryId,
		intakeId,
		attemptId: crypto.randomUUID(),
		documentId,
		createdAt: new Date().toISOString(),
		formatVersion: '1'
	}
	const tx = first.db.beginTransaction()
	tx.insert(app.captureIntakes, submitted, { id: intakeId })
	tx.insert(app.captureObservations, failure)
	tx.insert(app.captureCompletions, completion)
	await tx.commit().wait({ tier: 'global' })
	expect(await second.db.one(app.captureIntakes.where({ id: intakeId }))).toMatchObject(submitted)
	expect(await second.db.all(app.captureObservations.where({ intakeId }))).toMatchObject([failure])
	expect(await second.db.all(app.captureCompletions.where({ intakeId }))).toMatchObject([
		completion
	])
})
