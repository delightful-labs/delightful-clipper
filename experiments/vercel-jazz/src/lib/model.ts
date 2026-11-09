import { schema as s } from 'jazz-tools'
// A disposable model, independent of Finance, Clipper, and DLF.
export const app = s.defineApp(
	{ records: s.table({ ownerId: s.uuid(), text: s.string() }, {}) },
	{ migrations: 'none' }
)
export const permissions = s.definePermissions(app, ({ policy, session }) => {
	policy.records.allowRead.where({ ownerId: session.user })
	policy.records.allowInsert.where({ ownerId: session.user })
	policy.records.allowUpdate.whereOld({ ownerId: session.user }).whereNew({ ownerId: session.user })
	policy.records.allowDelete.where({ ownerId: session.user })
})
