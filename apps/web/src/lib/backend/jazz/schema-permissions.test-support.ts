import permissions from './permissions.js'

/** Historical fixtures use current policies only for tables present at that step. */
export function permissionsForSchema(schema: { wasmSchema: object }) {
	return Object.fromEntries(
		Object.entries(permissions).filter(([table]) => Object.hasOwn(schema.wasmSchema, table))
	)
}
