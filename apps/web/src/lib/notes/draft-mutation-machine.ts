import type { EventPayload } from '../machines/events.js'
import { types, createActor, createCallbackLogic, setup, toPromise, createAsyncLogic } from 'xstate'

import type { NoteDraftRecord } from './schema.js'
import { openDraftDatabase } from './draft-database.js'
import {
	canRecoverDraft,
	canReplaceRecoveredDraft,
	isStoredDraft,
	matchesStoredDraft,
	matchesStoredLegacyDraft
} from './draft-recovery.js'
import type { prepareDraftRecovery } from './draft-recovery.js'
import { required } from '../machines/storage/domain-transaction.js'

export type DraftEntry = { key: string; target: string; record: NoteDraftRecord }
type Recovery = ReturnType<typeof prepareDraftRecovery>
type Input =
	| { kind: 'recover'; entry: DraftEntry; sourceKey: string; recovery: Recovery }
	| { kind: 'remove'; entry: DraftEntry }
type Command = {
	type: 'READ_SOURCE' | 'READ_DESTINATION' | 'READ_CURRENT' | 'MOVE' | 'DELETE' | 'ABORT'
}
type Event =
	| { type: 'OPENED' | 'COMPLETED' | 'ABORTED' | 'STORAGE_ERROR' }
	| { type: 'SOURCE_READ' | 'DESTINATION_READ' | 'CURRENT_READ'; value: unknown }
type Context = { input: Input; db: IDBDatabase | undefined }

function recoveryInput(input: Input) {
	if (input.kind !== 'recover') throw new Error('Missing draft recovery input')
	return input
}
const actors = {
	open: createAsyncLogic({ run: () => openDraftDatabase() }),
	storage: createCallbackLogic<Command, { db: IDBDatabase; operation: Input }>(
		({ input, sendBack, receive }) => {
			const tx = input.db.transaction(['noteDrafts', 'drafts'], 'readwrite', {
				durability: 'strict'
			})
			const notes = tx.objectStore('noteDrafts'),
				legacy = tx.objectStore('drafts')
			tx.oncomplete = () => sendBack({ type: 'COMPLETED' })
			tx.onabort = () => sendBack({ type: 'ABORTED' })
			tx.onerror = () => sendBack({ type: 'STORAGE_ERROR' })
			function read(
				store: IDBObjectStore,
				key: string,
				type: 'SOURCE_READ' | 'DESTINATION_READ' | 'CURRENT_READ'
			) {
				const request = store.get(key)
				request.onsuccess = () => sendBack({ type, value: request.result })
			}
			function abort() {
				try {
					tx.abort()
				} catch {
					sendBack({ type: 'ABORTED' })
				}
			}
			const commands: Record<Command['type'], () => void> = {
				READ_SOURCE: () => read(legacy, recoveryInput(input.operation).sourceKey, 'SOURCE_READ'),
				READ_DESTINATION: () => read(notes, input.operation.entry.key, 'DESTINATION_READ'),
				READ_CURRENT: () => read(notes, input.operation.entry.key, 'CURRENT_READ'),
				MOVE: () => {
					notes.put(input.operation.entry)
					legacy.delete(recoveryInput(input.operation).sourceKey)
				},
				DELETE: () => {
					notes.delete(input.operation.entry.key)
				},
				ABORT: abort
			}
			receive((command) => {
				try {
					commands[command.type]()
				} catch {
					sendBack({ type: 'STORAGE_ERROR' })
				}
			})
			sendBack({ type: 'OPENED' })
			return () => input.db.close()
		}
	)
}
/** Request callbacks deliver facts synchronously. Guards select the next command
 * before that callback returns, keeping every compare and mutation in the same
 * active IndexedDB transaction. Completion alone acknowledges durability. */
export const draftMutationMachine = setup({
	schemas: {
		context: types<Context>(),
		events: {
			OPENED: types<EventPayload<Event, 'OPENED'>>(),
			COMPLETED: types<EventPayload<Event, 'COMPLETED'>>(),
			ABORTED: types<EventPayload<Event, 'ABORTED'>>(),
			STORAGE_ERROR: types<EventPayload<Event, 'STORAGE_ERROR'>>(),
			SOURCE_READ: types<EventPayload<Event, 'SOURCE_READ'>>(),
			DESTINATION_READ: types<EventPayload<Event, 'DESTINATION_READ'>>(),
			CURRENT_READ: types<EventPayload<Event, 'CURRENT_READ'>>()
		},
		input: types<Input>(),
		output: types<void>(),
		tags: types<string>(),
		children: {
			open: types<import('xstate').ActorRefFrom<(typeof actors)['open']>>(),
			storage: types<import('xstate').ActorRefFrom<(typeof actors)['storage']>>()
		}
	},
	actors,
	guards: {
		recoveryRequested: ({ context }: { context: Context }) => context.input.kind === 'recover',
		recoveryAssociated: ({ context }: { context: Context }) => {
			const { recovery } = recoveryInput(context.input)
			return canRecoverDraft(recovery.source, recovery.note, recovery.libraryId, recovery.aliases)
		},
		sourceUnchanged: ({ context }: { context: Context }, params: { value: unknown }) =>
			matchesStoredLegacyDraft(params.value, recoveryInput(context.input).recovery.source),
		destinationCompatible: ({ context }: { context: Context }, params: { value: unknown }) =>
			canReplaceRecoveredDraft(params.value, context.input.entry.record),
		currentMissing: (
			_: { context: Context; value: import('xstate').StateValue },
			params: { value: unknown }
		) => params.value === undefined,
		currentValid: (
			_: { context: Context; value: import('xstate').StateValue },
			params: { value: unknown }
		) => isStoredDraft(params.value),
		currentMatches: ({ context }: { context: Context }, params: { value: unknown }) =>
			matchesStoredDraft(params.value, context.input.entry.record)
	},
	actions: {
		rememberDatabase: (args: { context: Context }, params: { db: IDBDatabase }) => ({
			context: { db: ((_, params: { db: IDBDatabase }) => params.db)(args, params) }
		}),

		fail: () => {
			throw new Error('Note draft transaction aborted')
		}
	}
}).createMachine({
	id: 'draft-mutation',
	context: ({ input }) => ({ input, db: undefined }),
	initial: 'selectingOperation',
	states: {
		selectingOperation: {
			type: 'choice',
			choice: (args) => {
				if (args.guards.recoveryRequested(args) && !args.guards.recoveryAssociated(args)) {
					return { target: 'failed' }
				}
				return { target: 'opening' }
			}
		},
		opening: {
			invoke: {
				id: 'open',
				src: 'open',
				onDone: (args) => {
					return {
						target: 'working',
						context: args.actions.rememberDatabase(args, { db: args.event.output }).context
					}
				},
				onError: { target: 'failed' }
			}
		},
		working: {
			invoke: {
				id: 'storage',
				src: 'storage',
				input: ({ context }: { context: Context }) => ({
					db: required(context.db),
					operation: context.input
				}),
				onError: { target: '#draft-mutation.failed' }
			},
			on: {
				COMPLETED: { target: '#draft-mutation.done' },
				ABORTED: { target: '#draft-mutation.failed' },
				STORAGE_ERROR: { target: '.aborting' }
			},
			initial: 'starting',
			states: {
				starting: {
					on: {
						OPENED: (args) => {
							if (args.guards.recoveryRequested(args)) {
								return { target: 'readingSource' }
							}
							return { target: 'readingCurrent' }
						}
					}
				},
				readingSource: {
					entry: (args, enq) => {
						enq.sendTo('storage', { type: 'READ_SOURCE' })
					},
					on: {
						SOURCE_READ: (args) => {
							const { event } = args
							if (args.guards.sourceUnchanged(args, event)) {
								return { target: 'readingDestination' }
							}
							return { target: 'aborting' }
						}
					}
				},
				readingDestination: {
					entry: (args, enq) => {
						enq.sendTo('storage', { type: 'READ_DESTINATION' })
					},
					on: {
						DESTINATION_READ: (args, enq) => {
							const { event } = args
							if (args.guards.destinationCompatible(args, event)) {
								enq.sendTo('storage', { type: 'MOVE' })
								return { target: 'waitingCompletion' }
							}
							return { target: 'aborting' }
						}
					}
				},
				readingCurrent: {
					entry: (args, enq) => {
						enq.sendTo('storage', { type: 'READ_CURRENT' })
					},
					on: {
						CURRENT_READ: (args, enq) => {
							const { event } = args
							if (args.guards.currentMissing(args, event)) {
								return { target: 'waitingCompletion' }
							}
							if (args.guards.currentMatches(args, event)) {
								enq.sendTo('storage', { type: 'DELETE' })
								return { target: 'waitingCompletion' }
							}
							if (args.guards.currentValid(args, event)) {
								return { target: 'waitingCompletion' }
							}
							return { target: 'aborting' }
						}
					}
				},
				aborting: {
					entry: (args, enq) => {
						enq.sendTo('storage', { type: 'ABORT' })
					}
				},
				waitingCompletion: {}
			}
		},
		failed: {
			entry: (args, enq) => {
				enq(args.actions.fail)
			}
		},
		done: { type: 'final' }
	}
})
/** Public promise API boundary; all child actors and transaction commands belong
 * to the one operation actor. No actor is started from inside an I/O leaf. */
export function runDraftMutation(input: Input) {
	const actor = createActor(draftMutationMachine, { input })
	const result = toPromise(actor)
	actor.start()
	return result
}
