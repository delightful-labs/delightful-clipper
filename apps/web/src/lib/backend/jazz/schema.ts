import { schema as s } from 'jazz-tools'

export const app = s.defineApp({
	libraries: s.table({ ownerId: s.uuid(), bootstrapVersion: s.string() }, {}),
	storageOperations: s.table(
		{ libraryId: s.uuid(), payloadHash: s.string(), createdAt: s.string() },
		{ library: s.rel('libraries', 'libraryId') }
	),
	blobManifests: s.table(
		{
			libraryId: s.uuid(),
			operationId: s.uuid(),
			mediaType: s.string(),
			encoding: s.string(),
			byteLength: s.int(),
			originalByteLength: s.int(),
			partCount: s.int(),
			hash: s.string()
		},
		{
			library: s.rel('libraries', 'libraryId'),
			operation: s.rel('storageOperations', 'operationId')
		}
	),
	blobParts: s.table(
		{
			libraryId: s.uuid(),
			manifestId: s.uuid(),
			ordinal: s.int(),
			byteLength: s.int(),
			hash: s.string(),
			payload: s.bytes()
		},
		{ library: s.rel('libraries', 'libraryId'), manifest: s.rel('blobManifests', 'manifestId') }
	),
	snapshots: s.table(
		{
			libraryId: s.uuid(),
			documentId: s.uuid(),
			text: s.string(),
			hash: s.string(),
			formatVersion: s.string()
		},
		{
			library: s.rel('libraries', 'libraryId'),
			operation: s.rel('storageOperations', 'documentId')
		}
	),
	documents: s.table(
		{
			libraryId: s.uuid(),
			operationId: s.uuid(),
			snapshotId: s.uuid(),
			manifestId: s.uuid(),
			title: s.string(),
			originalSavedAt: s.string()
		},
		{
			library: s.rel('libraries', 'libraryId'),
			operation: s.rel('storageOperations', 'operationId'),
			snapshot: s.rel('snapshots', 'snapshotId'),
			manifest: s.rel('blobManifests', 'manifestId')
		}
	)
})
