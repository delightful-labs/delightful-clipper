import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { createOrganizationMachine, type OrganizationDraft } from './organize.js'
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
			OrganizationDraft,
			object,
			null,
			SyncReceipt,
			object
		>({
			retainDetached: vi.fn(),
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
			createOrganizationMachine(
				(spawn, input) => spawn(stage, { input }),
				() => current
			),
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
		OrganizationDraft,
		object,
		null,
		SyncReceipt,
		object
	>({
		retainDetached: vi.fn(),
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
					createOrganizationMachine(
						(spawn, input) => spawn(stage, { input }),
						() => false
					),
					{ input: request }
				).start()
			)
		).kind
	).toBe('interrupted')
	expect(open).not.toHaveBeenCalled()
})
it('snapshots the desired scalar before asynchronous transaction work', async () => {
	const entered = Promise.withResolvers<void>(),
		gate = Promise.withResolvers<void>()
	const observed: string[] = []
	const input: OrganizationRequest = { id: crypto.randomUUID(), field: 'status', value: 'later' }
	const stage = createWorkspaceCreationTransaction<
		OrganizationDraft,
		object,
		null,
		SyncReceipt,
		object
	>({
		retainDetached: vi.fn(),
		open: () => ({}),
		readLocal: async () => {
			entered.resolve()
			await gate.promise
			return null
		},
		assess: () => ({ outcome: 'eligible' }),
		stage: (_, attempt) => {
			observed.push(String(attempt.draft.value))
			return { global: async () => {} }
		},
		commit: () => ({}),
		persistLocal: async () => {},
		rollback: () => true
	})
	const actor = createActor(
		createOrganizationMachine(
			(spawn, input) => spawn(stage, { input }),
			() => true
		),
		{ input }
	).start()
	await entered.promise
	input.value = 'archive'
	gate.resolve()
	expect((await toPromise(actor)).kind).toBe('saved')
	expect(observed).toEqual(['later'])
})
it.each(['shutdown', 'scope', 'failure'] as const)(
	'drains immutable history observation on %s before admitting a transaction',
	async (mode) => {
		const observation = Promise.withResolvers<never[]>(),
			entered = Promise.withResolvers<void>()
		let current = true
		const open = vi.fn(() => ({}))
		const stage = createWorkspaceCreationTransaction<
			OrganizationDraft,
			object,
			null,
			SyncReceipt,
			object
		>({
			retainDetached: vi.fn(),
			open,
			readLocal: async () => null,
			assess: () => ({ outcome: 'eligible' }),
			stage: () => ({ global: async () => {} }),
			commit: () => ({}),
			persistLocal: async () => {},
			rollback: () => true
		})
		const actor = createActor(
			createOrganizationMachine(
				(spawn, input) => spawn(stage, { input }),
				() => current,
				async () => {
					entered.resolve()
					return observation.promise
				}
			),
			{ input: request }
		).start()
		await entered.promise
		if (mode === 'scope') current = false
		else if (mode === 'shutdown') actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('active')
		if (mode === 'failure') observation.reject(new Error('history unavailable'))
		else observation.resolve([])
		expect((await toPromise(actor)).kind).toBe(mode === 'failure' ? 'failed' : 'interrupted')
		expect(open).not.toHaveBeenCalled()
		expect(actor.getSnapshot().context.operations).toEqual([])
	}
)

it('retains the issued identity when shutdown precedes operation admission', async () => {
	const stage = vi.fn(() => {
		throw new Error('Shutdown must precede native writes')
	})
	const actor = createActor(
		createOrganizationMachine(stage, () => true),
		{ input: request }
	).start()
	actor.send({ type: 'SHUTDOWN' })
	const result = await toPromise(actor)
	expect(result.kind).toBe('interrupted')
	expect(result.operationId).toMatch(
		/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
	)
	expect(stage).not.toHaveBeenCalled()
})
