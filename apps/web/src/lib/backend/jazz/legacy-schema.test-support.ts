import { schema as s } from 'jazz-tools'
// Exact persisted pre-article schema; keep this fixture independent of current app changes.
export const legacyApp = s.defineApp({
	articleSources: s.table(
		{
			documentId: s.uuid(),
			libraryId: s.uuid(),
			finalUrl: s.string(),
			submittedUrl: s.string(),
			provenance: s.string()
		},
		{
			documentIdRelation: s.rel('documents', 'documentId'),
			libraryIdRelation: s.rel('libraries', 'libraryId')
		}
	),
	assets: s.table(
		{
			libraryId: s.uuid(),
			operationId: s.uuid(),
			mediaType: s.string(),
			payload: s.bytes()
		},
		{
			libraryIdRelation: s.rel('libraries', 'libraryId'),
			operationIdRelation: s.rel('storageOperations', 'operationId')
		}
	),
	documents: s.table(
		{
			libraryId: s.uuid(),
			operationId: s.uuid(),
			snapshotId: s.uuid(),
			assetId: s.uuid(),
			title: s.string(),
			originalSavedAt: s.string()
		},
		{
			libraryIdRelation: s.rel('libraries', 'libraryId'),
			operationIdRelation: s.rel('storageOperations', 'operationId'),
			snapshotIdRelation: s.rel('snapshots', 'snapshotId'),
			assetIdRelation: s.rel('assets', 'assetId')
		}
	),
	libraries: s.table(
		{
			ownerId: s.uuid(),
			bootstrapVersion: s.string()
		},
		{}
	),
	snapshots: s.table(
		{
			libraryId: s.uuid(),
			documentId: s.uuid(),
			text: s.string(),
			formatVersion: s.string()
		},
		{
			libraryIdRelation: s.rel('libraries', 'libraryId'),
			documentIdRelation: s.rel('storageOperations', 'documentId')
		}
	),
	storageOperations: s.table(
		{
			libraryId: s.uuid(),
			payloadHash: s.string(),
			createdAt: s.string()
		},
		{
			libraryIdRelation: s.rel('libraries', 'libraryId')
		}
	)
})
