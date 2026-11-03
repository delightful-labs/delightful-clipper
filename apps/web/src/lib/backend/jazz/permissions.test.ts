import { afterAll, beforeAll, expect, it } from 'vitest'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp } from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'

let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterAll(async () => {
	await fixture?.shutdown()
})
it('converges identical canonical ensures and rejects alternate/foreign roots', async () => {
	const owner = {
		user_id: 'clipper-owner',
		authMode: 'local-first',
		claims: {}
	} satisfies import('jazz-tools/testing').PolicyTestSession
	const ownerId = fixture.accountFor(owner)
	const a = fixture.as(owner),
		b = fixture.as(owner)
	const payload = { ownerId, bootstrapVersion: '1' }
	await Promise.all([
		a.upsert(app.libraries, ownerId, payload).wait({ tier: 'global' }),
		b.upsert(app.libraries, ownerId, payload).wait({ tier: 'global' })
	])
	await a.upsert(app.libraries, ownerId, payload).wait({ tier: 'global' })
	expect((await a.all(app.libraries.where({ ownerId }))).map((row) => row.id)).toEqual([ownerId])
	await expect(
		a.insert(app.libraries, payload, { id: crypto.randomUUID() }).wait({ tier: 'global' })
	).rejects.toThrow(/AuthorizationDenied|Write rejected/)
	await expect(
		a.update(app.libraries, ownerId, { bootstrapVersion: '2' }).wait({ tier: 'global' })
	).rejects.toThrow(/AuthorizationDenied|Write rejected/)
	const stranger = fixture.as({ user_id: 'clipper-stranger', authMode: 'local-first', claims: {} })
	expect(await stranger.one(app.libraries.where({ id: ownerId }))).toBeNull()
	await expect(async () =>
		stranger.upsert(app.libraries, ownerId, payload).wait({ tier: 'global' })
	).rejects.toThrow(/denied|rejected/i)
})
