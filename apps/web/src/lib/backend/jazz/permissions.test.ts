import { policySchema } from './schema-permissions.test-support.js'
import { afterAll, beforeAll, expect, it } from 'vitest'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp } from 'jazz-tools/testing'
import { app } from './schema.js'
import permissions from './permissions.js'

let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(policySchema(), permissions, expect)
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

it('keeps backend auth records unreadable and immutable to guest and signed-in clients', async () => {
	const userId = crypto.randomUUID()
	const stateId = crypto.randomUUID()
	await fixture.seed((db) =>
		db.insert(
			app.better_auth_user,
			{
				name: 'Private provider user',
				email: 'private@example.invalid',
				emailVerified: false,
				createdAt: new Date(),
				updatedAt: new Date()
			},
			{ id: userId }
		)
	)
	await fixture.seed((db) =>
		db.insert(
			app.better_auth_atprotoState,
			{
				stateKey: 'private-state',
				stateData: 'private-provider-state',
				expiresAt: new Date(Date.now() + 60000)
			},
			{ id: stateId }
		)
	)
	for (const session of [
		{ user_id: 'auth-guest', authMode: 'local-first' as const, claims: {} },
		{
			user_id: userId,
			issuer: 'https://example.invalid',
			authMode: 'external' as const,
			claims: {}
		}
	]) {
		const db = fixture.as(session)
		expect(await db.all(app.better_auth_user)).toEqual([])
		expect(await db.all(app.better_auth_session)).toEqual([])
		expect(await db.all(app.better_auth_account)).toEqual([])
		expect(await db.all(app.better_auth_verification)).toEqual([])
		expect(await db.all(app.better_auth_atprotoSession)).toEqual([])
		expect(await db.all(app.better_auth_atprotoState)).toEqual([])
		await db.expectDenied((client) =>
			client.update(app.better_auth_user, userId, { name: 'Changed' })
		)
		await db.expectDenied((client) => client.delete(app.better_auth_atprotoState, stateId))
		await db.expectDenied((client) =>
			client.insert(app.better_auth_atprotoState, {
				stateKey: 'forged-state',
				stateData: 'forged',
				expiresAt: new Date()
			})
		)
	}
})
