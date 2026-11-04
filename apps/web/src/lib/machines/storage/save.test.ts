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
