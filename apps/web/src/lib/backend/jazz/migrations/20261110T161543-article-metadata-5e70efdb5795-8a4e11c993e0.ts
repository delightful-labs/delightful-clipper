import { schema as s, migration as m } from 'jazz-tools'

export default m.defineMigration({
	migrate: {
		snapshots: {
			author: m.add.string({ default: null }),
			siteName: m.add.string({ default: null }),
			publishedTime: m.add.string({ default: null }),
			lang: m.add.string({ default: null }),
			dir: m.add.string({ default: null }),
			featuredImageUrl: m.add.string({ default: null })
		}
	},
	fromHash: '5e70efdb5795',
	toHash: '8a4e11c993e0',
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
				author: s.string().optional(),
				siteName: s.string().optional(),
				publishedTime: s.string().optional(),
				lang: s.string().optional(),
				dir: s.string().optional(),
				featuredImageUrl: s.string().optional(),
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
