import type { EventPayload } from '../machines/events.js'
import { types, setup, createAsyncLogic, matchesState } from 'xstate'

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
	persist: createAsyncLogic({
		run: async ({ input }: { input: { store: NoteDraftStore; record: NoteDraftRecord } }) => {
			await input.store.write(input.record)
			return input.record
		}
	})
}
export const noteDraftMachine = setup({
	schemas: {
		context: types<Context>(),
		events: {
			EDIT: types<EventPayload<Event, 'EDIT'>>(),
			RETRY: types<EventPayload<Event, 'RETRY'>>(),
			SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>()
		},
		input: types<Input>(),
		output: types<{ unsaved: NoteDraftRecord[] }>(),
		tags: types<string>(),
		children: { persist: types<import('xstate').ActorRefFrom<(typeof actors)['persist']>>() }
	},
	actors,
	guards: {
		queued: ({ context }: { context: Context }) => context.queue.length > 0,
		stopping: ({ value }: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'stopping' } }, value),
		accepting: ({ value }: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'accepting' } }, value),
		currentBinding: ({ context }: { context: Context }) => context.isCurrent(),
		admissibleEdit: ({ context, event }: { context: Context; event: Event }) =>
			event.type === 'EDIT' && canAdmitDraftEdit(event.record, context.libraryId, context)
	},
	actions: {
		enqueue: (args: { context: Context }, params: { record: NoteDraftRecord }) => ({
			context: {
				queue: (({ context }, params: { record: NoteDraftRecord }) =>
					replaceWriterDraft(context.queue, noteDraftRecordSchema.parse(params.record)))(
					args,
					params
				)
			}
		}),
		issue: ({ context }: { context: Context }) => ({
			context: { issued: context.queue[0], queue: context.queue.slice(1) }
		}),
		acknowledge: (args: { context: Context }, params: { record: NoteDraftRecord }) => ({
			context: {
				durable: (({ context }, params: { record: NoteDraftRecord }) =>
					replaceWriterDraft(context.durable, params.record))(args, params),
				issued: undefined
			}
		}),
		retainFailed: ({ context }: { context: Context }) => ({
			context: { queue: retainFailedDraft(context), issued: undefined }
		})
	}
}).createMachine({
	id: 'note-drafts',
	context: ({ input }) => ({ ...input, queue: [], issued: undefined, durable: [] }),
	initial: 'running',
	output: ({ context }) => ({ unsaved: context.queue }),
	states: {
		running: {
			type: 'parallel' as const,
			on: {
				EDIT: (args) => {
					if (
						!(
							matchesState({ running: { control: 'accepting' } }, args.value) &&
							args.guards.currentBinding(args) &&
							args.guards.admissibleEdit(args)
						)
					)
						return
					return { context: args.actions.enqueue(args, { record: args.event.record }).context }
				}
			},
			states: {
				control: {
					initial: 'accepting',
					states: { accepting: { on: { SHUTDOWN: { target: 'stopping' } } }, stopping: {} }
				},
				storage: {
					initial: 'routing',
					states: {
						routing: {
							type: 'choice',
							choice: (args) => {
								if (args.guards.queued(args)) {
									return { target: 'issuing' }
								}
								if (matchesState({ running: { control: 'stopping' } }, args.value)) {
									return { target: '#note-drafts.closed' }
								}
								return { target: 'idle' }
							}
						},
						idle: {
							always: (args) => {
								if (args.guards.queued(args)) {
									return { target: 'routing' }
								}
								if (matchesState({ running: { control: 'stopping' } }, args.value)) {
									return { target: '#note-drafts.closed' }
								}
							}
						},
						issuing: {
							always: (args) => ({ target: 'writing', context: args.actions.issue(args).context })
						},
						writing: {
							invoke: {
								id: 'persist',
								src: 'persist',
								input: ({ context }: { context: Context }) => ({
									store: context.store,
									record: requireIssuedDraft(context)
								}),
								onDone: (args) => {
									return {
										target: 'routing',
										context: args.actions.acknowledge(args, { record: args.event.output }).context
									}
								},
								onError: (args) => {
									return { target: 'failed', context: args.actions.retainFailed(args).context }
								}
							}
						},
						failed: {
							always: (args) => {
								if (!matchesState({ running: { control: 'stopping' } }, args.value)) return
								return { target: '#note-drafts.closed' }
							},
							on: { RETRY: { target: 'routing' } }
						}
					}
				}
			}
		},
		closed: { type: 'final' as const }
	}
})
