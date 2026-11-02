/** Isolated qualification experiment, not production bootstrap or a DLF implementation. */
import assert from 'node:assert/strict'
import { schema as s } from 'jazz-tools'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestSession } from 'jazz-tools/testing'
import type { RowRefValue } from 'jazz-tools/permissions'

const app = s.defineApp({
	libraries: s.table({ ownerId: s.uuid(), name: s.string() }, {}),
	creationOperations: s.table(
		{ ownerId: s.uuid(), libraryId: s.uuid(), operationId: s.uuid() },
		{ library: s.rel('libraries', 'libraryId') }
	),
	assets: s.table(
		{ libraryId: s.uuid(), payload: s.bytes() },
		{ library: s.rel('libraries', 'libraryId') }
	)
})

const permissions = s.definePermissions(app, ({ policy, session, allOf }) => {
	const ownsLibrary = (id: string | RowRefValue) =>
		policy.libraries.exists.where({ id, ownerId: session.user.account })
	policy.libraries.allowRead.where({ ownerId: session.user.account })
	policy.libraries.allowInsert.where({ ownerId: session.user.account })
	policy.libraries.allowUpdate.whereOld({ ownerId: session.user.account })
		.whereNew({ ownerId: session.user.account })
	policy.libraries.allowDelete.never()
	policy.creationOperations.allowRead.where((row) =>
		allOf([{ ownerId: session.user.account }, ownsLibrary(row.libraryId)])
	)
	policy.creationOperations.allowInsert.where((row) =>
		allOf([{ ownerId: session.user.account }, ownsLibrary(row.libraryId)])
	)
	policy.creationOperations.allowUpdate.never()
	policy.creationOperations.allowDelete.never()
	policy.assets.allowRead.where((row) => ownsLibrary(row.libraryId))
	policy.assets.allowInsert.where((row) => ownsLibrary(row.libraryId))
	policy.assets.allowUpdate.never()
	policy.assets.allowDelete.never()
})

// SDK helper accepts an assertion adapter. Its assertion conveniences are unused here.
const fixture = await createPolicyTestApp(app, permissions, () => {
	throw new Error('Unexpected SDK assertion-helper invocation')
})
const owner = { user_id: 'clipper-proof-owner', authMode: 'local-first', claims: {} } satisfies PolicyTestSession
const stranger = { user_id: 'clipper-proof-stranger', authMode: 'local-first', claims: {} } satisfies PolicyTestSession
const passed: string[] = []
const denied = /AuthorizationDenied|Write rejected by server authorization/

try {
	const db = fixture.as(owner)
	const other = fixture.as(stranger)
	const ownerId = fixture.accountFor(owner)
	const strangerId = fixture.accountFor(stranger)
	const libraryId = crypto.randomUUID()
	const operationId = crypto.randomUUID()
	const tx = db.beginExclusiveTransaction()
	tx.insert(app.libraries, { ownerId, name: 'Qualification library' }, { id: libraryId })
	tx.insert(app.creationOperations, { ownerId, libraryId, operationId }, { id: operationId })
	const commit = tx.commit()
	await commit.wait()
	const marker = await db.one(app.creationOperations.where({ id: operationId }))
	assert.equal(marker?.libraryId, libraryId)
	assert.equal((await db.one(app.libraries.where({ id: libraryId })))?.ownerId, ownerId)
	passed.push('exclusive creation accepted with workspace and operation marker')

	const asset = db.insert(app.assets, { libraryId, payload: new Uint8Array([1, 2, 3]) })
	await asset.wait({ tier: 'global' })
	const ownAsset = await db.one(app.assets.where({ id: asset.value.id }))
	assert.deepEqual(ownAsset?.payload, new Uint8Array([1, 2, 3]))
	assert.equal(await other.one(app.libraries.where({ id: libraryId })), null)
	assert.equal(await other.one(app.creationOperations.where({ id: operationId })), null)
	assert.equal(await other.one(app.assets.where({ id: asset.value.id })), null)
	passed.push('unrelated account cannot read workspace, marker or asset bytes')

	await assert.rejects(
		other.insert(app.libraries, { ownerId, name: 'Forged owner' }).wait({ tier: 'global' }),
		denied
	)
	await assert.rejects(
		other.insert(app.assets, { libraryId, payload: new Uint8Array([4]) }).wait({ tier: 'global' }),
		denied
	)
	await assert.rejects(
		db.update(app.libraries, libraryId, { ownerId: strangerId }).wait({ tier: 'global' }),
		denied
	)
	passed.push('authority rejects forged ownership, foreign-parent asset and ownership transfer')

	const rejectedLibraryId = crypto.randomUUID()
	const rejectedOperationId = crypto.randomUUID()
	const rejected = db.beginExclusiveTransaction()
	rejected.insert(app.libraries, { ownerId, name: 'Must not partially commit' }, { id: rejectedLibraryId })
	rejected.insert(app.creationOperations,
		{ ownerId: strangerId, libraryId: rejectedLibraryId, operationId: rejectedOperationId },
		{ id: rejectedOperationId })
	await assert.rejects(rejected.commit().wait(), denied)
	assert.equal(await db.one(app.libraries.where({ id: rejectedLibraryId })), null)
	assert.equal(await db.one(app.creationOperations.where({ id: rejectedOperationId })), null)
	passed.push('invalid ownership marker rejects the whole exclusive creation')

	const cancelledId = crypto.randomUUID()
	const cancelled = db.beginTransaction()
	cancelled.insert(app.libraries, { ownerId, name: 'Rolled back' }, { id: cancelledId })
	assert.equal(await cancelled.rollback(), true)
	assert.equal(await db.one(app.libraries.where({ id: cancelledId })), null)
	passed.push('precommit rollback does not publish workspace to authority reads')

	console.log(JSON.stringify({ status: 'passed', sdk: '2.0.0-alpha.59', passed,
		limits: ['isolated local authority and memory clients', 'not a DLF packaged integration',
			'no browser cold restart, crash recovery, offline provisioning or Netlify qualification'] }, null, 2))
} finally {
	await fixture.shutdown()
}
