import { schema as s } from 'jazz-tools'

export default s.defineMigration({
	createTables: {
		articles: true
	},
	fromHash: '9251313c0afe',
	toHash: '80988faa7219',
	from: {
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
	},
	to: {
		articles: s.table(
			{
				libraryId: s.uuid(),
				url: s.string(),
				originalSavedAt: s.string(),
				contentId: s.uuid().optional(),
				operationId: s.uuid().optional(),
				failure: s.string().optional()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				content: s.rel('documents', 'contentId')
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
				library: s.rel('libraries', 'libraryId'),
				operation: s.rel('storageOperations', 'operationId')
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
				library: s.rel('libraries', 'libraryId'),
				operation: s.rel('storageOperations', 'operationId'),
				snapshot: s.rel('snapshots', 'snapshotId'),
				asset: s.rel('assets', 'assetId')
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
				library: s.rel('libraries', 'libraryId'),
				operation: s.rel('storageOperations', 'documentId')
			}
		),
		storageOperations: s.table(
			{
				libraryId: s.uuid(),
				payloadHash: s.string(),
				createdAt: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId')
			}
		)
	}
})
