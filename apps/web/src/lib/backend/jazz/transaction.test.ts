import { afterAll, beforeAll, expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { createPolicyTestApp } from 'jazz-tools/testing'
import type { PolicyTestApp, PolicyTestSession } from 'jazz-tools/testing'
import type { WriteHandle } from 'jazz-tools'
import type { SyncReceipt } from '../../contracts/storage.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import type { TransactionResource } from './transaction.js'
import { app } from './schema.js'
import permissions from './permissions.js'
let fixture: PolicyTestApp
beforeAll(async () => {
	fixture = await createPolicyTestApp(app, permissions, expect)
})
afterAll(async () => {
	await fixture?.shutdown()
})
it('rejects a stale binding at admission without opening a native transaction', () => {
	const beginTransaction = vi.fn(() => {
		throw new Error('Unexpected transaction')
	})
	expect(() => transactionLifecycle({ beginTransaction }, () => false).open()).toThrow(
		'scope expired'
	)
	expect(beginTransaction).not.toHaveBeenCalled()
})
it.each(['scope', 'shutdown', 'committed', 'uncertain'] as const)(
	'retains native transaction ownership during %s loss',
	async (mode) => {
		const session: PolicyTestSession = {
			user_id: `transaction-${mode}`,
			authMode: 'local-first',
			claims: {}
		}
		const db = fixture.as(session),
			libraryId = fixture.accountFor(session)
		await db
			.upsert(app.libraries, libraryId, { ownerId: libraryId, bootstrapVersion: '1' })
			.wait({ tier: 'global' })
		let current = true
		const gate = Promise.withResolvers<void>(),
			entered = Promise.withResolvers<void>()
		const lifecycle = transactionLifecycle(db, () => current)
		const resource = lifecycle.open()
		const nativeCommit = vi.spyOn(resource.tx, 'commit'),
			rollback = vi.fn(lifecycle.rollback)
		const id = crypto.randomUUID()
		const actor = createActor(
			createWorkspaceCreationTransaction<null, TransactionResource, null, SyncReceipt, WriteHandle>(
				{
					...lifecycle,
					open: () => resource,
					readLocal: async () => {
						if (mode !== 'committed' && mode !== 'uncertain') {
							entered.resolve()
							await gate.promise
						}
						return null
					},
					assess: () => ({ outcome: 'eligible' }),
					stage: (r) => {
						r.tx.insert(
							app.articles,
							{
								libraryId,
								url: 'https://example.com/',
								originalSavedAt: new Date().toISOString(),
								contentId: null,
								operationId: null,
								failure: null
							},
							{ id }
						)
						return transactionReceipt(r)
					},
					persistLocal: async (write) => {
						entered.resolve()
						await gate.promise
						await lifecycle.persistLocal(write)
					},
					rollback
				}
			),
			{ input: { attempt: { operationId: id, workspaceId: id, membershipId: id, draft: null } } }
		).start()
		await entered.promise
		current = false
		if (mode !== 'scope') actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('active')
		if (mode === 'uncertain') gate.reject(new Error('Local settlement unknown'))
		else gate.resolve()
		const result = await toPromise(actor)
		if (mode === 'committed' || mode === 'uncertain') {
			expect(result.settlement.kind).toBe(mode === 'uncertain' ? 'unresolved' : 'locallyPersisted')
			expect(nativeCommit).toHaveBeenCalledOnce()
			expect(rollback).toHaveBeenCalledTimes(mode === 'uncertain' ? 1 : 0)
		} else {
			expect(nativeCommit).not.toHaveBeenCalled()
			expect(rollback).toHaveBeenCalledOnce()
			expect(await db.all(app.articles.where({ libraryId }))).toEqual([])
		}
	}
)
