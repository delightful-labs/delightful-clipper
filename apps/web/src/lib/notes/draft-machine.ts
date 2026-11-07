import { and, assign, fromPromise, setup, stateIn } from 'xstate'
import type { NoteDraftRecord } from './schema.js'
import { noteDraftRecordSchema } from './schema.js'
import {
	canAdmitDraftEdit,
	replaceWriterDraft,
	retainFailedDraft,
	requireIssuedDraft
} from './draft-state.js'
import type { NoteDraftStore } from './drafts.js'

type Input = { store: NoteDraftStore; libraryId: string; isCurrent: () => boolean }
type Context = Input & {
	queue: NoteDraftRecord[]
	issued: NoteDraftRecord | undefined
	durable: NoteDraftRecord[]
}
type Event = { type: 'EDIT'; record: NoteDraftRecord } | { type: 'RETRY' | 'SHUTDOWN' }
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
	{
		enqueue: undefined
		issue: undefined
		acknowledge: { record: NoteDraftRecord }
		retainFailed: undefined
	},
	{
		queued: undefined
		stopping: undefined
		accepting: undefined
		currentBinding: undefined
		admissibleEdit: undefined
		canEdit: undefined
	},
	never,
	string,
	Input,
	{ unsaved: NoteDraftRecord[] }
>({
	actors,
	guards: {
		queued: ({ context }) => context.queue.length > 0,
		stopping: stateIn({ running: { control: 'stopping' } }),
		accepting: stateIn({ running: { control: 'accepting' } }),
		currentBinding: ({ context }) => context.isCurrent(),
		admissibleEdit: ({ context, event }) =>
			event.type === 'EDIT' && canAdmitDraftEdit(event.record, context.libraryId, context),
		canEdit: and(['accepting', 'currentBinding', 'admissibleEdit'])
	},
	actions: {
		enqueue: assign({
			queue: ({ context, event }) =>
				event.type === 'EDIT'
					? replaceWriterDraft(context.queue, noteDraftRecordSchema.parse(event.record))
					: context.queue
		}),
		issue: assign({
			issued: ({ context }) => context.queue[0],
			queue: ({ context }) => context.queue.slice(1)
		}),
		acknowledge: assign({
			durable: ({ context }, params: { record: NoteDraftRecord }) =>
				replaceWriterDraft(context.durable, params.record),
			issued: undefined
		}),
		retainFailed: assign({
			queue: ({ context }) => retainFailedDraft(context),
			issued: undefined
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
							entry: 'issue',
							invoke: {
								src: 'persist',
								input: ({ context }) => ({
									store: context.store,
									record: requireIssuedDraft(context)
								}),
								onDone: {
									target: 'routing',
									actions: {
										type: 'acknowledge',
										params: ({ event }) => ({ record: event.output })
									}
								},
								onError: {
									target: 'failed',
									actions: 'retainFailed'
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
