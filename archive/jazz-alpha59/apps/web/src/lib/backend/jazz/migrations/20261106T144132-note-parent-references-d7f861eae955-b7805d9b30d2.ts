import { schema as s } from 'jazz-tools'

export default s.defineMigration({
	migrate: {
		articleNoteRevisions: {
			articleParentId: s.add.ref('articles', { default: null }),
			documentParentId: s.add.ref('documents', { default: null })
		}
	},
	fromHash: 'd7f861eae955',
	toHash: 'b7805d9b30d2',
	from: {
		articleNoteRevisions: s.table(
			{
				libraryId: s.uuid(),
				articleId: s.uuid(),
				text: s.string(),
				parents: s.string(),
				editedAt: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId')
			}
		),
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
	},
	to: {
		articleNoteRevisions: s.table(
			{
				libraryId: s.uuid(),
				articleId: s.uuid(),
				articleParentId: s.uuid().optional(),
				documentParentId: s.uuid().optional(),
				text: s.string(),
				parents: s.string(),
				editedAt: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId'),
				articleParent: s.rel('articles', 'articleParentId'),
				documentParent: s.rel('documents', 'documentParentId')
			}
		),
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
