import { Pool } from 'pg'
import { z } from 'zod'

const postgresConnection = z.url().refine((value) => {
	return ['postgres:', 'postgresql:'].includes(new URL(value).protocol)
})

/** The auth server owns this pool and must close it when its lifetime ends. */
export function createAuthDatabase(connectionString = process.env.AUTH_DATABASE_URL): Pool {
	const parsed = postgresConnection.safeParse(connectionString)
	if (!parsed.success) throw new Error('Auth storage requires a Postgres AUTH_DATABASE_URL')
	return new Pool({ connectionString: parsed.data })
}
