import { schema as s } from 'jazz-tools'
export const app = s.defineApp(
	{ items: s.table({ ownerId: s.uuid(), title: s.string() }, {}) },
	{ migrations: 'none' }
)
export const permissions = s.definePermissions(app, ({ policy, session }) => {
	policy.items.allowRead.where({ ownerId: session.user })
	policy.items.allowInsert.where({ ownerId: session.user })
	policy.items.allowUpdate.whereOld({ ownerId: session.user }).whereNew({ ownerId: session.user })
	policy.items.allowDelete.never()
})
