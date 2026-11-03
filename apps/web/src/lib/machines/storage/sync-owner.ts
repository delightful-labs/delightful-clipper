import { enqueueActions, setup } from 'xstate'
import type { ActorRef, ActorRefFrom, Snapshot } from 'xstate'
import { storageSyncMachine } from './sync.js'
import type { SyncOutcome } from './sync.js'
import type { ReceiptWatch, SyncReport } from '../../contracts/storage.js'
type Watch = { documentId: string; ref: ActorRefFrom<typeof storageSyncMachine> }
type Context = {
	reportTo: ActorRef<Snapshot<unknown>, SyncReport> | undefined
	watches: Record<string, Watch>
	sequence: number
}
type Input = { reportTo: ActorRef<Snapshot<unknown>, SyncReport> }
type Event =
	| ReceiptWatch
	| { type: 'SHUTDOWN' }
	| { type: `xstate.done.actor.sync:${string}`; actorId: string; output: SyncOutcome }
	| { type: `xstate.error.actor.sync:${string}`; actorId: string; error: unknown }
/** Own concurrent receipt actors; dropping an observer never cancels or replays a write. */
export const syncOwnerMachine = setup<
	Context,
	Event,
	{ sync: typeof storageSyncMachine },
	{},
	{ watch: undefined; complete: undefined; clear: undefined },
	{},
	never,
	string,
	Input
>({
	actors: { sync: storageSyncMachine },
	actions: {
		watch: enqueueActions(({ context, event, enqueue }) => {
			if (event.type !== 'WATCH') return
			for (const watch of Object.values(context.watches))
				if (watch.documentId === event.id) {
					enqueue.sendTo(watch.ref, { type: 'SHUTDOWN' })
					enqueue.stopChild(watch.ref)
				}
			enqueue.assign(({ context, spawn }) => {
				const sequence = context.sequence + 1,
					key = `sync:${sequence}`
				const watches = Object.fromEntries(
					Object.entries(context.watches).filter(([, watch]) => watch.documentId !== event.id)
				)
				return {
					sequence,
					watches: {
						...watches,
						[key]: { documentId: event.id, ref: spawn('sync', { id: key, input: event.receipts }) }
					}
				}
			})
		}),
		complete: enqueueActions(({ context, event, enqueue }) => {
			if (!('actorId' in event)) return
			const watch = context.watches[event.actorId]
			if (!watch) return
			const status = 'output' in event ? event.output.status : 'rejected'
			if (context.reportTo && status !== 'stopped')
				enqueue.sendTo(context.reportTo, { type: 'SYNC', id: watch.documentId, status })
			enqueue.stopChild(watch.ref)
			enqueue.assign(({ context }) => {
				const watches = { ...context.watches }
				delete watches[event.actorId]
				return { watches }
			})
		}),
		clear: enqueueActions(({ context, enqueue }) => {
			for (const watch of Object.values(context.watches)) {
				enqueue.sendTo(watch.ref, { type: 'SHUTDOWN' })
				enqueue.stopChild(watch.ref)
			}
			enqueue.assign({ watches: {}, reportTo: undefined })
		})
	}
}).createMachine({
	id: 'sync-owner',
	initial: 'watching',
	context: ({ input }) => ({ reportTo: input.reportTo, watches: {}, sequence: 0 }),
	states: {
		watching: {
			on: {
				WATCH: { actions: 'watch' },
				'xstate.done.actor.*': { actions: 'complete' },
				'xstate.error.actor.*': { actions: 'complete' },
				SHUTDOWN: 'closed'
			}
		},
		closed: { type: 'final', entry: 'clear' }
	}
})
