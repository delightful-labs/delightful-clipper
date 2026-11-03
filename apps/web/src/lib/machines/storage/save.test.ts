import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { createSaveRecordMachine } from './save.js'
import { storageSyncMachine } from './sync.js'
import { prepareSave } from '../../storage/codec.js'
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
				parts: stage,
				publish: stage,
				readParts: async () => draft.parts,
				verify: async () => {}
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
