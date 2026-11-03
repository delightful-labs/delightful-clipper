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
	policy.captureIntakes.allowRead.where((row) => owns(row.libraryId))
	policy.captureIntakes.allowInsert.where((row) =>
		allOf([owns(row.libraryId), { formatVersion: '1' }])
	)
	policy.captureIntakes.allowUpdate.never()
	policy.captureIntakes.allowDelete.never()
	policy.captureObservations.allowRead.where((row) => owns(row.libraryId))
	policy.captureObservations.allowInsert.where((row) =>
		allOf([
			owns(row.libraryId),
			{ formatVersion: '1' },
			policy.captureIntakes.exists.where({ id: row.intakeId, libraryId: row.libraryId })
		])
	)
	policy.captureObservations.allowUpdate.never()
	policy.captureObservations.allowDelete.never()
	policy.captureCompletions.allowRead.where((row) => owns(row.libraryId))
	policy.captureCompletions.allowInsert.where((row) =>
		allOf([
			owns(row.libraryId),
			{ formatVersion: '1' },
			policy.captureIntakes.exists.where({ id: row.intakeId, libraryId: row.libraryId }),
			policy.documents.exists.where({ id: row.documentId, libraryId: row.libraryId })
		])
	)
	policy.captureCompletions.allowUpdate.never()
	policy.captureCompletions.allowDelete.never()
	policy.storageOperations.allowRead.where((row) => owns(row.libraryId))
	policy.storageOperations.allowInsert.where((row) => owns(row.libraryId))
	policy.storageOperations.allowUpdate.never()
	policy.storageOperations.allowDelete.never()
	policy.assets.allowRead.where((row) => owns(row.libraryId))
	policy.assets.allowInsert.where((row) =>
		allOf([
			owns(row.libraryId),
			policy.storageOperations.exists.where({ id: row.operationId, libraryId: row.libraryId })
		])
	)
	policy.assets.allowUpdate.never()
	policy.assets.allowDelete.never()
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
			policy.assets.exists.where({
				id: row.assetId,
				operationId: row.operationId,
				libraryId: row.libraryId
			})
		])
	)
	policy.articleSources.allowRead.where((row) => owns(row.libraryId))
	policy.articleSources.allowInsert.where((row) =>
		allOf([
			owns(row.libraryId),
			policy.documents.exists.where({ id: row.documentId, libraryId: row.libraryId })
		])
	)
	policy.articleSources.allowUpdate.never()
	policy.articleSources.allowDelete.never()
	policy.documents.allowUpdate.never()
	policy.documents.allowDelete.never()
})
