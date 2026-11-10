import { schema as s, migration as m } from 'jazz-tools'

export default m.defineMigration({
	migrate: {
		snapshots: {
			excerpt: m.add.string({ default: null })
		}
	},
	fromHash: '7c74c142a5dc',
	toHash: '5e70efdb5795',
	from: {
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
				excerpt: s.string().optional(),
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
