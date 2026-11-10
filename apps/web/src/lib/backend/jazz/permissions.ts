import { schema as s } from 'jazz-tools'
import type { RowRefValue } from 'jazz-tools/permissions'
import { app } from './schema.js'

export default s.definePermissions(app, ({ policy, session, allOf, anyOf }) => {
	policy.better_auth_user.allowRead.never()
	policy.better_auth_user.allowInsert.never()
	policy.better_auth_user.allowUpdate.never()
	policy.better_auth_user.allowDelete.never()

	policy.better_auth_session.allowRead.never()
	policy.better_auth_session.allowInsert.never()
	policy.better_auth_session.allowUpdate.never()
	policy.better_auth_session.allowDelete.never()

	policy.better_auth_account.allowRead.never()
	policy.better_auth_account.allowInsert.never()
	policy.better_auth_account.allowUpdate.never()
	policy.better_auth_account.allowDelete.never()

	policy.better_auth_verification.allowRead.never()
	policy.better_auth_verification.allowInsert.never()
	policy.better_auth_verification.allowUpdate.never()
	policy.better_auth_verification.allowDelete.never()

	policy.better_auth_atprotoSession.allowRead.never()
	policy.better_auth_atprotoSession.allowInsert.never()
	policy.better_auth_atprotoSession.allowUpdate.never()
	policy.better_auth_atprotoSession.allowDelete.never()

	policy.better_auth_atprotoState.allowRead.never()
	policy.better_auth_atprotoState.allowInsert.never()
	policy.better_auth_atprotoState.allowUpdate.never()
	policy.better_auth_atprotoState.allowDelete.never()

	const canonical = () =>
		allOf([{ id: session.user }, { ownerId: session.user }, { bootstrapVersion: '1' }])
	const owns = (libraryId: string | RowRefValue) =>
		policy.libraries.exists.where({ id: libraryId, ownerId: session.user })
	policy.libraries.allowRead.where({ ownerId: session.user })
	policy.libraries.allowInsert.where(canonical)
	policy.libraries.allowUpdate.whereOld(canonical).whereNew(canonical)
	policy.libraries.allowDelete.never()
	type NoteParent = { libraryId: RowRefValue; articleId: RowRefValue; documentId: RowRefValue }
	const articleNoteParent = (row: NoteParent) =>
		allOf([
			{ documentId: null },
			policy.articles.exists.where({ id: row.articleId, libraryId: row.libraryId })
		])
	const documentNoteParent = (row: NoteParent) =>
		allOf([
			{ articleId: null },
			policy.documents.exists.where({ id: row.documentId, libraryId: row.libraryId })
		])
	const ownedNoteParent = (row: NoteParent) =>
		allOf([owns(row.libraryId), anyOf([articleNoteParent(row), documentNoteParent(row)])])
	policy.notes.allowRead.where((row) => owns(row.libraryId))
	policy.notes.allowInsert.where(ownedNoteParent)
	policy.notes.allowUpdate.never()
	policy.notes.allowDelete.never()
	policy.noteRevisions.allowRead.where((row) => owns(row.libraryId))
	policy.noteRevisions.allowInsert.where((row) =>
		allOf([
			owns(row.libraryId),
			policy.notes.exists.where({ id: row.noteId, libraryId: row.libraryId })
		])
	)
	policy.noteRevisions.allowUpdate.never()
	policy.noteRevisions.allowDelete.never()
	policy.articleNoteRevisions.allowRead.where((row) => owns(row.libraryId))
	policy.articleNoteRevisions.allowInsert.never()
	policy.articleNoteRevisions.allowUpdate.never()
	policy.articleNoteRevisions.allowDelete.never()

	const imageParent = (row: { libraryId: RowRefValue; documentId: RowRefValue }) =>
		allOf([
			owns(row.libraryId),
			policy.documents.exists.where({ id: row.documentId, libraryId: row.libraryId })
		])
	policy.articleImages.allowRead.where((row) => owns(row.libraryId))
	policy.articleImages.allowInsert.where((row) =>
		allOf([imageParent(row), { status: 'pending' }, { assetId: null }])
	)
	policy.articleImages.allowUpdate
		.whereOld((row) =>
			allOf([owns(row.libraryId), anyOf([{ status: 'pending' }, { status: 'failed' }])])
		)
		.whereNew((row) =>
			allOf([
				imageParent(row),
				anyOf([
					allOf([{ status: 'failed' }, { assetId: null }]),
					allOf([
						{ status: 'ready' },
						policy.assets.exists.where({ id: row.assetId, libraryId: row.libraryId })
					])
				])
			])
		)
	policy.articleImages.allowDelete.never()
	policy.readerOperations.allowRead.where((row) => owns(row.libraryId))
	policy.readerOperations.allowInsert.where((row) =>
		allOf([
			owns(row.libraryId),
			anyOf([
				allOf([
					{ documentId: null },
					anyOf(['theme', 'font', 'size', 'spacing', 'width'].map((field) => ({ field })))
				]),
				allOf([
					{ field: 'position' },
					policy.documents.exists.where({ id: row.documentId, libraryId: row.libraryId })
				])
			])
		])
	)
	policy.readerOperations.allowUpdate.never()
	policy.readerOperations.allowDelete.never()
	policy.tagOperations.allowRead.where((row) => owns(row.libraryId))
	policy.tagOperations.allowInsert.where((row) =>
		allOf([
			owns(row.libraryId),
			anyOf([
				allOf([
					{ documentId: null },
					policy.articles.exists.where({ id: row.articleId, libraryId: row.libraryId })
				]),
				allOf([
					{ articleId: null },
					policy.documents.exists.where({ id: row.documentId, libraryId: row.libraryId })
				])
			])
		])
	)
	policy.tagOperations.allowUpdate.never()
	policy.tagOperations.allowDelete.never()
	policy.organizationOperations.allowRead.where((row) => owns(row.libraryId))
	policy.organizationOperations.allowInsert.where((row) =>
		allOf([
			owns(row.libraryId),
			anyOf([
				allOf([
					{ documentId: null },
					policy.articles.exists.where({ id: row.articleId, libraryId: row.libraryId })
				]),
				allOf([
					{ articleId: null },
					policy.documents.exists.where({ id: row.documentId, libraryId: row.libraryId })
				])
			]),
			anyOf([
				allOf([
					{ field: 'status' },
					anyOf([{ value: 'inbox' }, { value: 'later' }, { value: 'archive' }])
				]),
				allOf([{ field: 'favorite' }, anyOf([{ value: 'true' }, { value: 'false' }])]),
				allOf([{ field: 'trashed' }, anyOf([{ value: 'true' }, { value: 'false' }])])
			])
		])
	)
	policy.organizationOperations.allowUpdate.never()
	policy.organizationOperations.allowDelete.never()
	policy.articles.allowRead.where((row) => owns(row.libraryId))
	const articleTarget = (row: { libraryId: RowRefValue; contentId: RowRefValue }) =>
		allOf([
			owns(row.libraryId),
			anyOf([
				{ contentId: null },
				policy.documents.exists.where({ id: row.contentId, libraryId: row.libraryId })
			])
		])
	policy.articles.allowInsert.where(articleTarget)
	// Completed article content is fixed; pending articles can record work/failures and complete once.
	policy.articles.allowUpdate
		.whereOld((row) => allOf([owns(row.libraryId), { contentId: null }]))
		.whereNew(articleTarget)
	policy.articles.allowDelete.never()
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
