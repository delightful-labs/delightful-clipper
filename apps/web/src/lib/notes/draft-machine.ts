import { and, assign, fromPromise, setup, stateIn } from 'xstate'
import type { NoteDraftRecord } from './schema.js'
import { noteDraftRecordSchema, sameNote } from './schema.js'
import type { NoteDraftStore } from './drafts.js'

type Input = { store: NoteDraftStore; libraryId: string; isCurrent: () => boolean }
type Context = Input & {
	queue: NoteDraftRecord[]
	issued: NoteDraftRecord | undefined
	durable: NoteDraftRecord[]
}
type Event = { type: 'EDIT'; record: NoteDraftRecord } | { type: 'RETRY' | 'SHUTDOWN' }
function sameWriter(a: NoteDraftRecord, b: NoteDraftRecord) {
	return a.writerId === b.writerId && sameNote(a.draft, b.draft)
}
function replace(records: NoteDraftRecord[], next: NoteDraftRecord) {
	return [...records.filter((record) => !sameWriter(record, next)), next]
}
/** Serial local-draft ownership is independent of source writes and connectivity.
 * Shutdown drains edits already admitted under the original account binding. */
const actors = {
	persist: fromPromise(
		async ({ input }: { input: { store: NoteDraftStore; record: NoteDraftRecord } }) => {
			await input.store.write(input.record)
			return input.record
		}
	)
}
export const noteDraftMachine = setup<
	Context,
	Event,
	typeof actors,
	{},
	{ enqueue: undefined },
	{ queued: undefined; stopping: undefined; canEdit: undefined },
	never,
	string,
	Input,
	{ unsaved: NoteDraftRecord[] }
>({
	actors,
	guards: {
		queued: ({ context }) => context.queue.length > 0,
		stopping: stateIn({ running: { control: 'stopping' } }),
		canEdit: and([
			stateIn({ running: { control: 'accepting' } }),
			({ context, event }) => {
				if (!context.isCurrent() || event.type !== 'EDIT') return false
				const parsed = noteDraftRecordSchema.safeParse(event.record)
				if (!parsed.success || parsed.data.draft.libraryId !== context.libraryId) return false
				const previous = [
					...context.queue,
					...context.durable,
					...(context.issued ? [context.issued] : [])
				]
				return previous
					.filter((record) => sameWriter(record, parsed.data))
					.every((record) => record.draft.sequence < parsed.data.draft.sequence)
			}
		])
	},
	actions: {
		enqueue: assign({
			queue: ({ context, event }) =>
				event.type === 'EDIT'
					? replace(context.queue, noteDraftRecordSchema.parse(event.record))
					: context.queue
		})
	}
}).createMachine({
	id: 'note-drafts',
	context: ({ input }) => ({ ...input, queue: [], issued: undefined, durable: [] }),
	initial: 'running',
	output: ({ context }) => ({ unsaved: context.queue }),
	states: {
		running: {
			type: 'parallel',
			on: { EDIT: { guard: 'canEdit', actions: 'enqueue' } },
			states: {
				control: {
					initial: 'accepting',
					states: { accepting: { on: { SHUTDOWN: 'stopping' } }, stopping: {} }
				},
				storage: {
					initial: 'routing',
					states: {
						routing: {
							always: [
								{ guard: 'queued', target: 'writing' },
								{ guard: 'stopping', target: '#note-drafts.closed' },
								{ target: 'idle' }
							]
						},
						idle: {
							always: [
								{ guard: 'queued', target: 'routing' },
								{ guard: 'stopping', target: '#note-drafts.closed' }
							]
						},
						writing: {
							entry: assign({
								issued: ({ context }) => context.queue[0],
								queue: ({ context }) => context.queue.slice(1)
							}),
							invoke: {
								src: 'persist',
								input: ({ context }) => {
									if (!context.issued) throw new Error('Missing issued draft')
									return { store: context.store, record: context.issued }
								},
								onDone: {
									target: 'routing',
									actions: assign({
										durable: ({ context, event }) => replace(context.durable, event.output),
										issued: undefined
									})
								},
								onError: {
									target: 'failed',
									actions: assign({
										queue: ({ context }) => {
											const issued = context.issued
											if (!issued || context.queue.some((record) => sameWriter(record, issued)))
												return context.queue
											return [issued, ...context.queue]
										},
										issued: undefined
									})
								}
							}
						},
						failed: {
							always: { guard: 'stopping', target: '#note-drafts.closed' },
							on: { RETRY: 'routing' }
						}
					}
				}
			}
		},
		closed: { type: 'final' }
	}
})
