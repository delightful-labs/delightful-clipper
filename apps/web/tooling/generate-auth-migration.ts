import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { getMigrations } from 'better-auth/db/migration'
import { jwt } from 'better-auth/plugins'
import { atproto } from '@kingironman2011/better-auth-bsky'
import { z } from 'zod'
import { createAuthDatabase } from '../src/lib/server/auth/database.ts'

// Generation introspects an empty local database. Never use a hosted connection.
const localConnection = z.url().refine((value) => {
	const url = new URL(value)
	return (
		['postgres:', 'postgresql:'].includes(url.protocol) &&
		['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
	)
})
const parsed = localConnection.safeParse(process.env.AUTH_MIGRATION_LOCAL_DATABASE_URL)
if (!parsed.success) throw new Error('Auth migration generation requires a local Postgres URL')

const database = createAuthDatabase(parsed.data)
try {
	const migration = await getMigrations({
		database,
		plugins: [atproto({ clientName: 'Delightful Clipper' }), jwt()]
	})
	if (migration.toBeAdded.length || migration.toBeAddedIndexes.length) {
		throw new Error('Initial auth migration generation requires an empty local database')
	}
	if (!migration.toBeCreated.length || migration.schemaProblems.length) {
		throw new Error('Initial auth migration generation requires a clean local database')
	}
	const sql = await migration.compileMigrations()
	const directory = resolve(import.meta.dirname, '../../../netlify/database/migrations')
	await mkdir(directory, { recursive: true })
	await writeFile(resolve(directory, '20261106000100_auth.sql'), sql, { flag: 'wx' })
	console.info('Generated initial Better Auth / AT Protocol / JWT migration; no SQL applied.')
} finally {
	await database.end()
}
