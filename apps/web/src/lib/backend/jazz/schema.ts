import { schema as s } from 'jazz-tools'

export const app = s.defineApp({
	libraries: s.table({ ownerId: s.uuid(), bootstrapVersion: s.string() }, {})
})
