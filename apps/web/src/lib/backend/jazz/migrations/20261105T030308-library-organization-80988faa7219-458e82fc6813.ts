import { schema as s } from 'jazz-tools'

export default s.defineMigration({
	createTables: {
		organizationOperations: true
	},
	fromHash: '80988faa7219',
	toHash: '458e82fc6813',
	from: {
		libraries: s.table(
			{
				ownerId: s.uuid(),
				bootstrapVersion: s.string()
			},
			{}
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
		organizationOperations: s.table(
			{
				libraryId: s.uuid(),
				articleId: s.uuid(),
				field: s.string(),
				value: s.string(),
				parents: s.string()
			},
			{
				library: s.rel('libraries', 'libraryId')
			}
		)
	}
})
