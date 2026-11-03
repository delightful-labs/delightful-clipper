import { schema as s } from 'jazz-tools'

export const app = s.defineApp({
	captureIntakes: s.table(
		{
			libraryId: s.uuid(),
			submittedUrl: s.string(),
			fetchUrl: s.string(),
			createdAt: s.string(),
			formatVersion: s.string()
		},
		{ library: s.rel('libraries', 'libraryId') }
	),
	captureObservations: s.table(
		{
			libraryId: s.uuid(),
			intakeId: s.uuid(),
			attemptId: s.uuid(),
			kind: s.string(),
			payload: s.string(),
			createdAt: s.string(),
			formatVersion: s.string()
		},
		{ library: s.rel('libraries', 'libraryId'), intake: s.rel('captureIntakes', 'intakeId') }
	),
	// Completion has a required parent instead of a conditional reference in an opaque payload.
	captureCompletions: s.table(
		{
			libraryId: s.uuid(),
			intakeId: s.uuid(),
			attemptId: s.uuid(),
			documentId: s.uuid(),
			createdAt: s.string(),
			formatVersion: s.string()
		},
		{
			library: s.rel('libraries', 'libraryId'),
			intake: s.rel('captureIntakes', 'intakeId'),
			document: s.rel('documents', 'documentId')
		}
	),
	articleSources: s.table(
		{
			documentId: s.uuid(),
			libraryId: s.uuid(),
			finalUrl: s.string(),
			submittedUrl: s.string(),
			provenance: s.string()
		},
		{ library: s.rel('libraries', 'libraryId'), document: s.rel('documents', 'documentId') }
	),
	libraries: s.table({ ownerId: s.uuid(), bootstrapVersion: s.string() }, {}),
	storageOperations: s.table(
		{ libraryId: s.uuid(), payloadHash: s.string(), createdAt: s.string() },
		{ library: s.rel('libraries', 'libraryId') }
	),
	assets: s.table(
		{ libraryId: s.uuid(), operationId: s.uuid(), mediaType: s.string(), payload: s.bytes() },
		{
			library: s.rel('libraries', 'libraryId'),
			operation: s.rel('storageOperations', 'operationId')
		}
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
	)
})
