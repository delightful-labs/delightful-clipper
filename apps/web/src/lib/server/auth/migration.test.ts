import { expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createJazz, sqlite } from 'jazz-tools/backend'
import { app as beforeAuth } from '../../../../tests/fixtures/schema-history/preauth-schema.test-support.js'
import { app } from '../../backend/jazz/schema.js'
import permissions from '../../backend/jazz/permissions.js'
import { permissionsForSchema } from '../../backend/jazz/schema-permissions.test-support.js'
import { createAuthServer } from './server.js'

it('adds auth storage to a persisted main-branch Jazz store without resetting its library', async () => {
	const directory = await mkdtemp(join(tmpdir(), 'clipper-auth-upgrade-'))
	const id = crypto.randomUUID()
	let jazz = createJazz({
		app: beforeAuth,
		permissions: permissionsForSchema(beforeAuth),
		store: sqlite({ path: directory })
	})
	try {
		await jazz.db
			.insert(beforeAuth.libraries, { ownerId: id, bootstrapVersion: '1' }, { id })
			.wait({ tier: 'global' })
		await jazz.close()
		jazz = createJazz({ app, permissions, store: sqlite({ path: directory }) })
		expect(await jazz.db.one(app.libraries.where({ id }))).toMatchObject({
			id,
			ownerId: id,
			bootstrapVersion: '1'
		})
		const auth = createAuthServer(
			{ db: () => jazz.db, schema: app },
			{ origin: 'https://example.invalid', secret: 'auth-upgrade-secret-longer-than-32-characters' }
		)
		const context = await auth.$context
		const user = await context.internalAdapter.createUser(
			{ name: 'Upgrade fixture', email: 'upgrade@example.invalid' },
			{ method: 'admin' }
		)
		const session = await context.internalAdapter.createSession(user.id)
		expect(session.userId).toBe(user.id)
		expect(await jazz.db.all(app.better_auth_user)).toHaveLength(1)
		expect(await jazz.db.one(app.libraries.where({ id }))).toMatchObject({ ownerId: id })
	} finally {
		await jazz.close()
		await rm(directory, { recursive: true, force: true })
	}
})
