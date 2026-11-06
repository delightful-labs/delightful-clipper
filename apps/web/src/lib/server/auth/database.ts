import { getConnectionString } from '@netlify/database'
import { Pool } from 'pg'

/** The auth server owns this pool and must close it when its lifetime ends. */
export function createAuthDatabase(connectionString = getConnectionString()): Pool {
	return new Pool({ connectionString })
}
