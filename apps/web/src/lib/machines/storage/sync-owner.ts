import type { EventPayload } from '../events.js'
import { types, setup, type ActorRef, type ActorRefFrom, type Snapshot } from 'xstate'
import { storageSyncMachine } from './sync.js'
import type { ReceiptWatch, SyncReport } from '../../contracts/storage.js'

type Watch = { documentId: string; ref: ActorRefFrom<typeof storageSyncMachine> }
type Input = { reportTo: ActorRef<Snapshot<unknown>, SyncReport> }
type Context = {
	reportTo: Input['reportTo'] | undefined
	watches: Record<string, Watch>
	sequence: number
}
type Event = ReceiptWatch | { type: 'SHUTDOWN' }
function withoutWatch(watches: Context['watches'], actorId: string): Context['watches'] {
	const remaining = { ...watches }
	delete remaining[actorId]
	return remaining
}
function withoutDocument(watches: Context['watches'], documentId: string): Context['watches'] {
	return Object.fromEntries(
		Object.entries(watches).filter(([, watch]) => watch.documentId !== documentId)
	)
}
/** Receipt observers may be replaced/stopped; this never cancels or replays a write. */
export const syncOwnerMachine = setup({
	schemas: {
		context: types<Context>(),
		events: { WATCH: types<EventPayload<Event, 'WATCH'>>(), SHUTDOWN: types() },
		input: types<Input>(),
		children: { sync: types<ActorRefFrom<typeof storageSyncMachine>>() }
	},
	states: { watching: { schemas: { context: types<{ reportTo: Input['reportTo'] }>() } } },
	actors: { sync: storageSyncMachine }
}).createMachine({
	id: 'sync-owner',
	initial: 'watching',
	context: ({ input }) => ({ reportTo: input.reportTo, watches: {}, sequence: 0 }),
	states: {
		watching: {
			on: {
				WATCH: ({ context, event }, enq) => {
					for (const watch of Object.values(context.watches).filter(
						(watch) => watch.documentId === event.id
					)) {
						enq.sendTo(watch.ref, { type: 'SHUTDOWN' })
						enq.stop(watch.ref)
					}
					const sequence = context.sequence + 1,
						key = `sync:${sequence}`
					const ref = enq.spawn('sync', { id: key, input: event.receipts })
					return {
						context: {
							sequence,
							watches: {
								...withoutDocument(context.watches, event.id),
								[key]: { documentId: event.id, ref }
							}
						}
					}
				},
				'xstate.done.actor': ({ context, event }, enq) => {
					const watch = context.watches[event.actorId]
					if (!watch) return
					if (event.output.status !== 'stopped')
						enq.sendTo(context.reportTo, {
							type: 'SYNC',
							id: watch.documentId,
							status: event.output.status
						})
					enq.stop(watch.ref)
					return { context: { watches: withoutWatch(context.watches, event.actorId) } }
				},
				'xstate.error.actor': ({ context, event }, enq) => {
					const watch = context.watches[event.actorId]
					if (!watch) return
					enq.sendTo(context.reportTo, { type: 'SYNC', id: watch.documentId, status: 'rejected' })
					enq.stop(watch.ref)
					return { context: { watches: withoutWatch(context.watches, event.actorId) } }
				},
				SHUTDOWN: { target: 'closed' }
			}
		},
		closed: {
			type: 'final',
			entry: ({ context }, enq) => {
				for (const watch of Object.values(context.watches)) {
					enq.sendTo(watch.ref, { type: 'SHUTDOWN' })
					enq.stop(watch.ref)
				}
				return { context: { watches: {}, reportTo: undefined } }
			}
		}
	}
})
