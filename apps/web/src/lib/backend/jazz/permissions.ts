import { schema as s } from 'jazz-tools'
import type { RowRefValue } from 'jazz-tools/permissions'
import { app } from './schema.js'

export default s.definePermissions(app, ({ policy, session, allOf }) => {
	const canonical = () =>
		allOf([
			{ id: session.user.account },
			{ ownerId: session.user.account },
			{ bootstrapVersion: '1' }
		])
	const owns = (libraryId: string | RowRefValue) =>
		policy.libraries.exists.where({ id: libraryId, ownerId: session.user.account })
	policy.libraries.allowRead.where({ ownerId: session.user.account })
	policy.libraries.allowInsert.where(canonical)
	policy.libraries.allowUpdate.whereOld(canonical).whereNew(canonical)
	policy.libraries.allowDelete.never()
	policy.storageOperations.allowRead.where((row) => owns(row.libraryId))
	policy.storageOperations.allowInsert.where((row) => owns(row.libraryId))
	policy.storageOperations.allowUpdate.never()
	policy.storageOperations.allowDelete.never()
	const manifestOwner = (libraryId: RowRefValue, operationId: RowRefValue) =>
		allOf([owns(libraryId), policy.storageOperations.exists.where({ id: operationId, libraryId })])
	policy.blobManifests.allowRead.where((row) => owns(row.libraryId))
	policy.blobManifests.allowInsert.where((row) => manifestOwner(row.libraryId, row.operationId))
	policy.blobManifests.allowUpdate.never()
	policy.blobManifests.allowDelete.never()
	policy.blobParts.allowRead.where((row) => owns(row.libraryId))
	policy.blobParts.allowInsert.where((row) =>
		allOf([
			owns(row.libraryId),
			policy.blobManifests.exists.where({ id: row.manifestId, libraryId: row.libraryId })
		])
	)
	policy.blobParts.allowUpdate.never()
	policy.blobParts.allowDelete.never()
	policy.snapshots.allowRead.where((row) => owns(row.libraryId))
	policy.snapshots.allowInsert.where((row) =>
		allOf([
			owns(row.libraryId),
			{ formatVersion: '1' },
			policy.storageOperations.exists.where({
				id: row.documentId,
				libraryId: row.libraryId
			})
		])
	)
	policy.snapshots.allowUpdate.never()
	policy.snapshots.allowDelete.never()
	policy.documents.allowRead.where((row) => owns(row.libraryId))
	policy.documents.allowInsert.where((row) =>
		allOf([
			owns(row.libraryId),
			policy.storageOperations.exists.where({
				id: row.operationId,
				libraryId: row.libraryId
			}),
			policy.snapshots.exists.where({
				id: row.snapshotId,
				documentId: row.operationId,
				libraryId: row.libraryId
			}),
			policy.blobManifests.exists.where({
				id: row.manifestId,
				operationId: row.operationId,
				libraryId: row.libraryId
			})
		])
	)
	policy.documents.allowUpdate.never()
	policy.documents.allowDelete.never()
})
