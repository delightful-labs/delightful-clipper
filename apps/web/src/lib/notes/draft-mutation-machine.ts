import { assign, createActor, fromCallback, fromPromise, sendTo, setup, toPromise } from 'xstate'
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
import { required } from './operation-machine.js'

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
type Context = { input: Input; db: IDBDatabase | undefined; stored: unknown }

function recoveryInput(input: Input) {
	if (input.kind !== 'recover') throw new Error('Missing draft recovery input')
	return input
}
const actors = {
	open: fromPromise(() => openDraftDatabase()),
	storage: fromCallback<Command, { db: IDBDatabase; operation: Input }>(
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
export const draftMutationMachine = setup<
	Context,
	Event,
	typeof actors,
	{},
	{
		rememberDatabase: { db: IDBDatabase }
		rememberStored: { value: unknown }
		readSource: undefined
		readDestination: undefined
		readCurrent: undefined
		move: undefined
		remove: undefined
		abort: undefined
		fail: undefined
	},
	{
		recoveryRequested: undefined
		recoveryAssociated: undefined
		sourceUnchanged: undefined
		destinationCompatible: undefined
		currentMissing: undefined
		currentValid: undefined
		currentMatches: undefined
	},
	never,
	string,
	Input,
	void
>({
	actors,
	guards: {
		recoveryRequested: ({ context }) => context.input.kind === 'recover',
		recoveryAssociated: ({ context }) => {
			const { recovery } = recoveryInput(context.input)
			return canRecoverDraft(recovery.source, recovery.note, recovery.libraryId, recovery.aliases)
		},
		sourceUnchanged: ({ context }) =>
			matchesStoredLegacyDraft(context.stored, recoveryInput(context.input).recovery.source),
		destinationCompatible: ({ context }) =>
			canReplaceRecoveredDraft(context.stored, context.input.entry.record),
		currentMissing: ({ context }) => context.stored === undefined,
		currentValid: ({ context }) => isStoredDraft(context.stored),
		currentMatches: ({ context }) => matchesStoredDraft(context.stored, context.input.entry.record)
	},
	actions: {
		rememberDatabase: assign({ db: (_, params) => params.db }),
		rememberStored: assign({ stored: (_, params) => params.value }),
		readSource: sendTo('storage', { type: 'READ_SOURCE' }),
		readDestination: sendTo('storage', { type: 'READ_DESTINATION' }),
		readCurrent: sendTo('storage', { type: 'READ_CURRENT' }),
		move: sendTo('storage', { type: 'MOVE' }),
		remove: sendTo('storage', { type: 'DELETE' }),
		abort: sendTo('storage', { type: 'ABORT' }),
		fail: () => {
			throw new Error('Note draft transaction aborted')
		}
	}
}).createMachine({
	id: 'draft-mutation',
	context: ({ input }) => ({ input, db: undefined, stored: undefined }),
	initial: 'selectingOperation',
	states: {
		selectingOperation: {
			always: [{ guard: 'recoveryRequested', target: 'checkingAssociation' }, { target: 'opening' }]
		},
		checkingAssociation: {
			always: [{ guard: 'recoveryAssociated', target: 'opening' }, { target: 'failed' }]
		},
		opening: {
			invoke: {
				src: 'open',
				onDone: {
					target: 'working',
					actions: { type: 'rememberDatabase', params: ({ event }) => ({ db: event.output }) }
				},
				onError: 'failed'
			}
		},
		working: {
			invoke: {
				id: 'storage',
				src: 'storage',
				input: ({ context }) => ({ db: required(context.db), operation: context.input }),
				onError: '#draft-mutation.failed'
			},
			on: {
				COMPLETED: '#draft-mutation.done',
				ABORTED: '#draft-mutation.failed',
				STORAGE_ERROR: '.aborting'
			},
			initial: 'starting',
			states: {
				starting: {
					on: {
						OPENED: [
							{ guard: 'recoveryRequested', target: 'readingSource' },
							{ target: 'readingCurrent' }
						]
					}
				},
				readingSource: {
					entry: 'readSource',
					on: {
						SOURCE_READ: {
							target: 'checkingSource',
							actions: { type: 'rememberStored', params: ({ event }) => event }
						}
					}
				},
				checkingSource: {
					always: [
						{ guard: 'sourceUnchanged', target: 'readingDestination' },
						{ target: 'aborting' }
					]
				},
				readingDestination: {
					entry: 'readDestination',
					on: {
						DESTINATION_READ: {
							target: 'checkingDestination',
							actions: { type: 'rememberStored', params: ({ event }) => event }
						}
					}
				},
				checkingDestination: {
					always: [{ guard: 'destinationCompatible', target: 'moving' }, { target: 'aborting' }]
				},
				moving: { entry: 'move', always: 'waitingCompletion' },
				readingCurrent: {
					entry: 'readCurrent',
					on: {
						CURRENT_READ: {
							target: 'checkingCurrent',
							actions: { type: 'rememberStored', params: ({ event }) => event }
						}
					}
				},
				checkingCurrent: {
					always: [
						{ guard: 'currentMissing', target: 'waitingCompletion' },
						{ guard: 'currentValid', target: 'checkingAcknowledgment' },
						{ target: 'aborting' }
					]
				},
				checkingAcknowledgment: {
					always: [{ guard: 'currentMatches', target: 'deleting' }, { target: 'waitingCompletion' }]
				},
				deleting: { entry: 'remove', always: 'waitingCompletion' },
				aborting: { entry: 'abort' },
				waitingCompletion: {}
			}
		},
		failed: { entry: 'fail' },
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
