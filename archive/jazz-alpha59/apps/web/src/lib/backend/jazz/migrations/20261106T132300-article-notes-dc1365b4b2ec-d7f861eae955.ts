import { schema as s } from 'jazz-tools'

export default s.defineMigration({
	createTables: {
		articleNoteRevisions: true
	},
	fromHash: 'dc1365b4b2ec',
	toHash: 'd7f861eae955',
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
		libraries: s.table(
			{
				ownerId: s.uuid(),
				bootstrapVersion: s.string()
			},
			{}
		)
	}
})
