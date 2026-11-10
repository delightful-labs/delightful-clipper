import type { EventPayload } from '../events.js'
import { types, setup, type ActorRef, type ActorRefFrom, type Snapshot } from 'xstate'

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
	| { type: 'xstate.done.actor'; actorId: string; output: SyncOutcome }
	| { type: 'xstate.error.actor'; actorId: string; error: unknown }
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing sync owner resource')
	return value
}
function watchFor(context: Context, event: Event) {
	return 'actorId' in event ? context.watches[event.actorId] : undefined
}
/** Own concurrent receipt actors; dropping an observer never cancels or replays a write. */
export const syncOwnerMachine = setup({
	schemas: {
		context: types<Context>(),
		events: {
			WATCH: types<EventPayload<Event, 'WATCH'>>(),
			SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
		},
		input: types<Input>(),
		tags: types<string>(),
		children: { sync: types<import('xstate').ActorRefFrom<typeof storageSyncMachine>>() }
	},
	actors: { sync: storageSyncMachine },
	actions: {}
}).createMachine({
	id: 'sync-owner',
	initial: 'watching',
	context: ({ input }) => ({ reportTo: input.reportTo, watches: {}, sequence: 0 }),
	states: {
		watching: {
			on: {
				WATCH: (args, enq) => {
					const { event } = args
					let context = args.context
					let patch = {}
					{
						const contextBefore = args.context
						if (event.type !== 'WATCH') throw new Error('Expected receipt watch')
						for (const watch of Object.values(contextBefore.watches).filter(
							(watch) => watch.documentId === event.id
						)) {
							enq.sendTo(watch.ref, { type: 'SHUTDOWN' })
							enq.stop(watch.ref)
						}
						patch = {
							...patch,
							...(({ context, spawn }) => {
								const sequence = context.sequence + 1,
									key = `sync:${sequence}`
								const watches = Object.fromEntries(
									Object.entries(context.watches).filter(
										([, watch]) => watch.documentId !== event.id
									)
								)
								return {
									sequence,
									watches: {
										...watches,
										[key]: {
											documentId: event.id,
											ref: spawn('sync', { id: key, input: event.receipts })
										}
									}
								}
							})({ ...args, context, spawn: enq.spawn })
						}
						context = { ...args.context, ...patch }
					}
					return { context: patch }
				},
				'xstate.done.actor': (args, enq) => {
					let pendingContext = {}

					const { context, event } = args
					if (
						!!context.reportTo &&
						!!watchFor(context, event) &&
						'output' in event &&
						event.output.status !== 'stopped'
					) {
						enq.sendTo(
							required(context.reportTo),
							(({ context, event }): SyncReport => {
								if (!('output' in event) || event.output.status === 'stopped')
									throw new Error('Expected settled sync')
								return {
									type: 'SYNC',
									id: required(watchFor(context, event)).documentId,
									status: event.output.status
								}
							})(args)
						)
						{
							if (!('actorId' in event)) throw new Error('Expected child completion')
							const watch = context.watches[event.actorId]
							if (watch) enq.stop(watch.ref)
							pendingContext = {
								...pendingContext,
								...(({ context }) => {
									const watches = { ...context.watches }
									delete watches[event.actorId]
									return { watches }
								})({ ...args, context: { ...args.context, ...pendingContext }, spawn: enq.spawn })
							}
						}
						return { context: pendingContext }
					}
					{
						if (!('actorId' in event)) throw new Error('Expected child completion')
						const watch = context.watches[event.actorId]
						if (watch) enq.stop(watch.ref)
						pendingContext = {
							...pendingContext,
							...(({ context }) => {
								const watches = { ...context.watches }
								delete watches[event.actorId]
								return { watches }
							})({ ...args, context: { ...args.context, ...pendingContext }, spawn: enq.spawn })
						}
					}
					return { context: pendingContext }
				},
				'xstate.error.actor': (args, enq) => {
					let pendingContext = {}

					const { context, event } = args
					if (!!context.reportTo && !!watchFor(context, event)) {
						enq.sendTo(required(context.reportTo), {
							type: 'SYNC',
							id: required(watchFor(context, event)).documentId,
							status: 'rejected'
						})
						{
							if (!('actorId' in event)) throw new Error('Expected child completion')
							const watch = context.watches[event.actorId]
							if (watch) enq.stop(watch.ref)
							pendingContext = {
								...pendingContext,
								...(({ context }) => {
									const watches = { ...context.watches }
									delete watches[event.actorId]
									return { watches }
								})({ ...args, context: { ...args.context, ...pendingContext }, spawn: enq.spawn })
							}
						}
						return { context: pendingContext }
					}
					{
						if (!('actorId' in event)) throw new Error('Expected child completion')
						const watch = context.watches[event.actorId]
						if (watch) enq.stop(watch.ref)
						pendingContext = {
							...pendingContext,
							...(({ context }) => {
								const watches = { ...context.watches }
								delete watches[event.actorId]
								return { watches }
							})({ ...args, context: { ...args.context, ...pendingContext }, spawn: enq.spawn })
						}
					}
					return { context: pendingContext }
				},
				SHUTDOWN: { target: 'closed' }
			}
		},
		closed: {
			type: 'final',
			entry: (args, enq) => {
				let patch = {}
				{
					const contextBefore = args.context
					for (const watch of Object.values(contextBefore.watches)) {
						enq.sendTo(watch.ref, { type: 'SHUTDOWN' })
						enq.stop(watch.ref)
					}
					patch = { ...patch, watches: {}, reportTo: undefined }
				}
				return { context: patch }
			}
		}
	}
})
