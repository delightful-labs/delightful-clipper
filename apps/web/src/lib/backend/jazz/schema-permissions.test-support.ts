import { app } from './schema.js'
import permissions from './permissions.js'

/** Historical fixtures use current policies only for tables present at that step. */
export function permissionsForSchema(schema: { wasmSchema: object }) {
	return Object.fromEntries(
		Object.entries(permissions).filter(([table]) => Object.hasOwn(schema.wasmSchema, table))
	)
}

/** The SDK policy fixture deploys one schema without its migration graph. Give
 * both test peers that same isolated catalogue. Full app lenses are qualified
 * by migration.test.ts and the production offline tests instead. */
export function policySchema() {
	return { wasmSchema: structuredClone(app.wasmSchema) }
}
