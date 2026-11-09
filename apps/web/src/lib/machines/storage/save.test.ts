import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { createSaveRecordMachine } from './save.js'
import { storageSyncMachine } from './sync.js'
import { prepareSave } from '../../storage/prepare.js'
import type { PreparedSave, SyncReceipt } from '../../contracts/storage.js'

function deferred() {
	let resolve!: () => void
	let reject!: (error: Error) => void
	const promise = new Promise<void>((yes, no) => {
		resolve = yes
		reject = no
	})
	return { promise, resolve, reject }
}
it.each(['open', 'commit', 'local', 'uncertain', 'account'] as const)(
	'owns and settles resources during %s',
	async (mode) => {
		const gate = deferred(),
			entered = deferred()
		let current = true
		const commit = vi.fn(async () => {
			if (mode === 'commit') {
				entered.resolve()
				await gate.promise
			}
			return {}
		})
		const rollback = vi.fn(() => true)
		const receipt: SyncReceipt = { global: async () => {} }
		const stage = createWorkspaceCreationTransaction<
			PreparedSave,
			object,
			null,
			SyncReceipt,
			object
		>({
			retainDetached: vi.fn(),
			open: async () => {
				if (mode === 'open') {
					entered.resolve()
					await gate.promise
				}
				return {}
			},
			readLocal: async () => null,
			assess: () => ({ outcome: 'eligible' }),
			stage: () => receipt,
			commit,
			persistLocal: async () => {
				if (['local', 'uncertain', 'account'].includes(mode)) {
					entered.resolve()
					await gate.promise
				}
			},
			rollback
		})
		const request = {
			operationId: crypto.randomUUID(),
			title: 'Title',
			text: 'retained caller text',
			bytes: new Uint8Array([1]),
			mediaType: 'application/octet-stream'
		}
		const draft = await prepareSave(crypto.randomUUID(), request)
		const actor = createActor(
			createSaveRecordMachine({
				isCurrent: () => current,
				prepare: async () => draft,
				intent: stage,
				publish: stage
			}),
			{ input: request }
		).start()
		await entered.promise
		if (mode === 'account') current = false
		else actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('active')
		if (mode === 'uncertain') gate.reject(new Error('local durability unknown'))
		else gate.resolve()
		const result = await toPromise(actor)
		expect(result.kind).toBe(
			mode === 'uncertain' ? 'unknown' : mode === 'account' ? 'scopeChanged' : 'interrupted'
		)
		expect(commit.mock.calls.length).toBeLessThanOrEqual(1)
		expect(request.text).toBe('retained caller text')
	}
)
it('reports actual receipt rejection through the sync machine without invoking another save', async () => {
	const global = vi.fn(async () => {
		throw new Error('authority rejected')
	})
	const actor = createActor(storageSyncMachine, { input: [{ global }] }).start()
	await toPromise(actor)
	expect(actor.getSnapshot().value).toBe('rejected')
	expect(global).toHaveBeenCalledTimes(1)
})

it.each(['before', 'resolve', 'reject'] as const)(
	'keeps content-save scope enforcement in its owner during %s preparation',
	async (mode) => {
		const request = {
			operationId: crypto.randomUUID(),
			title: 'Title',
			text: 'Old account content',
			mediaType: 'text/plain',
			bytes: new Uint8Array([1])
		}
		const draft = await prepareSave(crypto.randomUUID(), request)
		let current = mode !== 'before'
		const gate = Promise.withResolvers<void>(),
			entered = Promise.withResolvers<void>()
		const open = vi.fn(() => ({})),
			commit = vi.fn(() => ({}))
		const stage = createWorkspaceCreationTransaction<
			PreparedSave,
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
			commit,
			persistLocal: async () => {},
			rollback: () => true
		})
		const prepare = vi.fn(async () => {
			entered.resolve()
			await gate.promise
			return draft
		})
		const actor = createActor(
			createSaveRecordMachine({ isCurrent: () => current, prepare, intent: stage, publish: stage }),
			{ input: request }
		).start()
		if (mode !== 'before') {
			await entered.promise
			current = false
			if (mode === 'reject') gate.reject(new Error('Old account preparation failed'))
			else gate.resolve()
		} else expect(prepare).not.toHaveBeenCalled()
		expect((await toPromise(actor)).kind).toBe('scopeChanged')
		expect(open).not.toHaveBeenCalled()
		expect(commit).not.toHaveBeenCalled()
	}
)

it.each(['resolve', 'reject'] as const)(
	'drains preparation %s after repeated shutdown without opening a transaction',
	async (settlement) => {
		const gate = Promise.withResolvers<PreparedSave>()
		const open = vi.fn(() => ({}))
		const stage = createWorkspaceCreationTransaction<
			PreparedSave,
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
		const request = {
			operationId: crypto.randomUUID(),
			title: 'Title',
			text: 'Text',
			bytes: new Uint8Array([1]),
			mediaType: 'text/plain'
		}
		const prepare = vi.fn(() => gate.promise)
		const actor = createActor(
			createSaveRecordMachine({ isCurrent: () => true, prepare, intent: stage, publish: stage }),
			{ input: request }
		).start()
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('active')
		if (settlement === 'resolve') gate.resolve(await prepareSave(crypto.randomUUID(), request))
		else gate.reject(new Error('preparation failed'))
		expect((await toPromise(actor)).kind).toBe('interrupted')
		expect(open).not.toHaveBeenCalled()
		expect(actor.getSnapshot().context.request).toBeUndefined()
	}
)

it.each(['blocked', 'failed', 'saved'] as const)(
	'selects the %s terminal state from native stage outcomes',
	async (expected) => {
		const receipt = { global: async () => {} }
		const commit = vi.fn(() => ({}))
		const rollback = vi.fn(() => true)
		const stage = createWorkspaceCreationTransaction<
			PreparedSave,
			object,
			null,
			SyncReceipt,
			object
		>({
			retainDetached: vi.fn(),
			open: () => ({}),
			readLocal: async () => null,
			assess: () =>
				expected === 'blocked'
					? { outcome: 'blocked', reason: 'existing intent' }
					: { outcome: 'eligible' },
			stage: () => {
				if (expected === 'failed') throw new Error('stage failed')
				return receipt
			},
			commit,
			persistLocal: async () => {},
			rollback
		})
		const request = {
			operationId: crypto.randomUUID(),
			title: 'Title',
			text: 'Text',
			bytes: new Uint8Array([1]),
			mediaType: 'text/plain'
		}
		const actor = createActor(
			createSaveRecordMachine({
				isCurrent: () => true,
				prepare: (input) => prepareSave(crypto.randomUUID(), input),
				intent: stage,
				publish: stage
			}),
			{ input: request }
		).start()
		const result = await toPromise(actor)
		expect(result.kind).toBe(expected)
		expect(actor.getSnapshot().matches(expected)).toBe(true)
		if (result.kind === 'saved') {
			expect(result.receipts).toEqual([receipt, receipt])
			expect(commit).toHaveBeenCalledTimes(2)
		} else expect(commit).not.toHaveBeenCalled()
		if (expected === 'failed') expect(rollback).toHaveBeenCalledOnce()
	}
)
