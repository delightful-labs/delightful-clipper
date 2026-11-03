import { expect, it } from 'vitest'
import { createActor, fromCallback, toPromise, waitFor } from 'xstate'
import { storageSyncMachine } from './sync.js'
import { syncOwnerMachine } from './sync-owner.js'
import type { SyncReport } from '../../contracts/storage.js'
function fixture() {
	const reports: SyncReport[] = []
	const sink = createActor(
		fromCallback<SyncReport>(({ receive }) => receive((event) => reports.push(event)))
	).start()
	const actor = createActor(syncOwnerMachine, { input: { reportTo: sink } }).start()
	return {
		actor,
		reports,
		close: async () => {
			actor.send({ type: 'SHUTDOWN' })
			await toPromise(actor)
			sink.stop()
		}
	}
}
it.each(['accepted', 'rejected', 'stopped'] as const)(
	'clears native receipts after %s',
	async (outcome) => {
		const pending = Promise.withResolvers<void>()
		const actor = createActor(storageSyncMachine, {
			input: [{ global: () => pending.promise }]
		}).start()
		if (outcome === 'accepted') pending.resolve()
		if (outcome === 'rejected') pending.reject(new Error('Denied'))
		if (outcome === 'stopped') actor.send({ type: 'SHUTDOWN' })
		expect(await toPromise(actor)).toEqual({ status: outcome })
		expect(actor.getSnapshot().context.receipts).toEqual([])
		expect(Object.keys(actor.getSnapshot().children)).toEqual([])
		if (outcome === 'stopped') {
			pending.reject(new Error('Late denial'))
			await Promise.resolve()
		}
	}
)
it('owns simultaneous article receipts and removes each settled child', async () => {
	const { actor, reports, close } = fixture(),
		a = Promise.withResolvers<void>(),
		b = Promise.withResolvers<void>()
	actor.send({ type: 'WATCH', id: 'a', receipts: [{ global: () => a.promise }] })
	actor.send({ type: 'WATCH', id: 'b', receipts: [{ global: () => b.promise }] })
	const children = Object.values(actor.getSnapshot().context.watches).map((watch) => watch.ref)
	expect(children).toHaveLength(2)
	b.reject(new Error('Rejected'))
	a.resolve()
	await waitFor(actor, (s) => Object.keys(s.context.watches).length === 0)
	expect(reports).toEqual(
		expect.arrayContaining([
			{ type: 'SYNC', id: 'a', status: 'accepted' },
			{ type: 'SYNC', id: 'b', status: 'rejected' }
		])
	)
	expect(Object.keys(actor.getSnapshot().children)).toEqual([])
	for (const child of children) expect(child.getSnapshot().context.receipts).toEqual([])
	await close()
})
it('stops old observers on replacement and ignores their late outcome', async () => {
	const { actor, reports, close } = fixture(),
		old = Promise.withResolvers<void>(),
		latest = Promise.withResolvers<void>()
	actor.send({ type: 'WATCH', id: 'a', receipts: [{ global: () => old.promise }] })
	const previous = Object.values(actor.getSnapshot().context.watches)[0]?.ref
	actor.send({ type: 'WATCH', id: 'a', receipts: [{ global: () => latest.promise }] })
	expect(previous?.getSnapshot().context.receipts).toEqual([])
	expect(Object.keys(actor.getSnapshot().context.watches)).toHaveLength(1)
	latest.resolve()
	await waitFor(actor, (s) => Object.keys(s.context.watches).length === 0)
	old.reject(new Error('Stale denial'))
	await new Promise((resolve) => setTimeout(resolve, 0))
	expect(reports).toEqual([{ type: 'SYNC', id: 'a', status: 'accepted' }])
	await close()
})
it('shutdown clears every observer without waiting for remote writes or reporting late failures', async () => {
	const { actor, reports, close } = fixture(),
		pending = Promise.withResolvers<void>()
	actor.send({ type: 'WATCH', id: 'a', receipts: [{ global: () => pending.promise }] })
	const child = Object.values(actor.getSnapshot().context.watches)[0]?.ref
	await close()
	expect(actor.getSnapshot().context).toMatchObject({ watches: {}, reportTo: undefined })
	expect(child?.getSnapshot().context.receipts).toEqual([])
	pending.reject(new Error('Late denial'))
	await new Promise((resolve) => setTimeout(resolve, 0))
	expect(reports).toEqual([])
})
