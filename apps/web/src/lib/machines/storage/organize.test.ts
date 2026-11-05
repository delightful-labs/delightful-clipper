import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { createOrganizationMachine } from './organize.js'
import type { OrganizationRequest } from '../../capture/organization.js'
import type { SyncReceipt } from '../../contracts/storage.js'
const request: OrganizationRequest = { id: crypto.randomUUID(), field: 'status', value: 'later' }
it.each(['open', 'read', 'stage', 'commit', 'local', 'unknown', 'scope'] as const)(
	'drains organization ownership at %s without replay',
	async (boundary) => {
		const gate = Promise.withResolvers<void>(),
			entered = Promise.withResolvers<void>()
		let current = true
		async function hold(point: string) {
			if (boundary === point || (point === 'local' && ['scope', 'unknown'].includes(boundary))) {
				entered.resolve()
				await gate.promise
			}
		}
		const commit = vi.fn(async () => {
				await hold('commit')
				return {}
			}),
			rollback = vi.fn(() => true)
		const stage = createWorkspaceCreationTransaction<
			OrganizationRequest,
			object,
			null,
			SyncReceipt,
			object
		>({
			open: async () => {
				await hold('open')
				return {}
			},
			readLocal: async () => {
				await hold('read')
				return null
			},
			assess: () => ({ outcome: 'eligible' }),
			stage: async () => {
				await hold('stage')
				return { global: async () => {} }
			},
			commit,
			persistLocal: async () => hold('local'),
			rollback
		})
		const actor = createActor(
			createOrganizationMachine(stage, () => current),
			{ input: request }
		).start()
		await entered.promise
		if (boundary === 'scope') current = false
		else actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('active')
		if (boundary === 'unknown') gate.reject(new Error('local durability unknown'))
		else gate.resolve()
		const result = await toPromise(actor)
		expect(result.kind).toBe(boundary === 'unknown' ? 'unknown' : 'interrupted')
		expect(commit.mock.calls.length).toBeLessThanOrEqual(1)
		expect(actor.getSnapshot().context.request).toBeUndefined()
	}
)
it('rejects stale admission before opening a transaction', async () => {
	const open = vi.fn(() => ({}))
	const stage = createWorkspaceCreationTransaction<
		OrganizationRequest,
		object,
		null,
		SyncReceipt,
		object
	>({
		open,
		readLocal: async () => null,
		assess: () => ({ outcome: 'eligible' }),
		stage: () => ({ global: async () => {} }),
		commit: () => ({}),
		persistLocal: async () => {},
		rollback: () => true
	})
	expect(
		(
			await toPromise(
				createActor(
					createOrganizationMachine(stage, () => false),
					{ input: request }
				).start()
			)
		).kind
	).toBe('interrupted')
	expect(open).not.toHaveBeenCalled()
})
