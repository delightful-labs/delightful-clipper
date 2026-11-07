import { expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import { noteDraftMachine } from './draft-machine.js'
import type { NoteDraftRecord } from './schema.js'
import { acknowledgesNoteDraft } from './schema.js'
const libraryId = crypto.randomUUID(),
	noteId = crypto.randomUUID(),
	writerId = crypto.randomUUID()
function record(sequence: number, text = `edit ${sequence}`): NoteDraftRecord {
	return { writerId, draft: { libraryId, noteId, sequence, text, baseRevisionIds: [] } }
}
function fixture(write: (record: NoteDraftRecord) => Promise<void>, isCurrent = () => true) {
	return createActor(noteDraftMachine, {
		input: {
			libraryId,
			store: { write, read: async () => [], remove: async () => {} },
			isCurrent
		}
	}).start()
}
it('coalesces unissued drafts and acknowledges only the exact completed sequence', async () => {
	const entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>()
	const write = vi.fn(async (_record: NoteDraftRecord): Promise<void> => {
		entered.resolve()
		await release.promise
	})
	const actor = fixture(write)
	actor.send({ type: 'EDIT', record: record(1) })
	await entered.promise
	actor.send({ type: 'EDIT', record: record(2) })
	actor.send({ type: 'EDIT', record: record(3) })
	expect(actor.getSnapshot().context.queue).toEqual([record(3)])
	expect(actor.getSnapshot().context.durable).toEqual([])
	release.resolve()
	await waitFor(actor, (snapshot) => snapshot.matches({ running: { storage: 'idle' } }))
	expect(write.mock.calls.map(([draft]) => draft)).toEqual([record(1), record(3)])
	expect(
		acknowledgesNoteDraft(record(3).draft, actor.getSnapshot().context.durable[0]!.draft)
	).toBe(true)
	actor.send({ type: 'SHUTDOWN' })
	expect(await toPromise(actor)).toEqual({ unsaved: [] })
})
it('drains issued and queued drafts on shutdown while rejecting new edits', async () => {
	const entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>()
	const writes: NoteDraftRecord[] = []
	const actor = fixture(async (draft) => {
		writes.push(draft)
		entered.resolve()
		await release.promise
	})
	actor.send({ type: 'EDIT', record: record(1) })
	await entered.promise
	actor.send({ type: 'EDIT', record: record(2) })
	actor.send({ type: 'SHUTDOWN' })
	actor.send({ type: 'EDIT', record: record(3) })
	expect(actor.getSnapshot().status).toBe('active')
	release.resolve()
	await toPromise(actor)
	expect(writes).toEqual([record(1), record(2)])
})
it('retains the newest text after storage failure and retries only on request', async () => {
	const entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>()
	const write = vi.fn(async (_record: NoteDraftRecord): Promise<void> => {
		entered.resolve()
		await release.promise
		throw new Error('quota')
	})
	const actor = fixture(write)
	actor.send({ type: 'EDIT', record: record(1) })
	await entered.promise
	actor.send({ type: 'EDIT', record: record(2) })
	release.resolve()
	await waitFor(actor, (snapshot) => snapshot.matches({ running: { storage: 'failed' } }))
	actor.send({ type: 'EDIT', record: record(3) })
	expect(write).toHaveBeenCalledOnce()
	expect(actor.getSnapshot().context.queue).toEqual([record(3)])
	write.mockImplementation(async () => {})
	actor.send({ type: 'RETRY' })
	await waitFor(actor, (snapshot) => snapshot.matches({ running: { storage: 'idle' } }))
	expect(actor.getSnapshot().context.durable).toEqual([record(3)])
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('returns unsaved authored text to its owner when shutdown cannot persist it', async () => {
	const actor = fixture(async () => {
		throw new Error('disk unavailable')
	})
	actor.send({ type: 'EDIT', record: record(1) })
	await waitFor(actor, (snapshot) => snapshot.matches({ running: { storage: 'failed' } }))
	actor.send({ type: 'SHUTDOWN' })
	expect(await toPromise(actor)).toEqual({ unsaved: [record(1)] })
})
it('keeps different tabs and notes independent and rejects duplicate or stale sequences', async () => {
	const writes: NoteDraftRecord[] = []
	const actor = fixture(async (value) => {
		writes.push(value)
	})
	const otherTab = { ...record(1), writerId: crypto.randomUUID() }
	const otherNote = {
		...record(1),
		draft: { ...record(1).draft, noteId: crypto.randomUUID() }
	}
	actor.send({ type: 'EDIT', record: record(2) })
	actor.send({ type: 'EDIT', record: record(1) })
	actor.send({ type: 'EDIT', record: record(2, 'same sequence other text') })
	actor.send({ type: 'EDIT', record: otherTab })
	actor.send({ type: 'EDIT', record: otherNote })
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
	expect(writes).toEqual([record(2), otherTab, otherNote])
})
it('rejects invalid or expired admission but drains previously admitted account-bound drafts', async () => {
	let current = true
	const entered = Promise.withResolvers<void>(),
		release = Promise.withResolvers<void>()
	const writes: NoteDraftRecord[] = []
	const actor = fixture(
		async (value) => {
			writes.push(value)
			entered.resolve()
			await release.promise
		},
		() => current
	)
	actor.send({ type: 'EDIT', record: { ...record(1), writerId: 'invalid' } })
	actor.send({ type: 'EDIT', record: record(1) })
	await entered.promise
	actor.send({ type: 'EDIT', record: record(2) })
	current = false
	actor.send({ type: 'EDIT', record: record(3) })
	actor.send({ type: 'SHUTDOWN' })
	release.resolve()
	await toPromise(actor)
	expect(writes).toEqual([record(1), record(2)])
})
