import type { ActorLogic, ActorRef, Snapshot } from 'xstate'
import type { Candidate } from '../capture/source.js'
import type {
	DocumentHeader,
	ReadCapabilities,
	ReadReport,
	SaveRequest,
	SaveResult,
	SyncReport
} from './storage.js'
export type CapturePreparation =
	| { kind: 'ready'; candidate: Candidate }
	| { kind: 'duplicate' | 'uncertain'; id: string }
	| { kind: 'scopeChanged' }
export type SaveRef = ActorRef<Snapshot<SaveResult>, { type: 'SHUTDOWN' }>
export type SaveSpawner = <S extends Snapshot<SaveResult>>(
	logic: ActorLogic<S, { type: 'SHUTDOWN' }, SaveRequest>,
	options: { input: SaveRequest }
) => ActorRef<S, { type: 'SHUTDOWN' }>
export type LibraryCapability = {
	isCurrent: () => boolean
	resolve: (url: string, requestId: string, signal: AbortSignal) => Promise<string>
	identify: (url: string, signal: AbortSignal) => Promise<string>
	hasDocument: (id: string, signal: AbortSignal) => Promise<boolean>
	hasIntent: (id: string, signal: AbortSignal) => Promise<boolean>
	extract: (url: string, requestId: string, signal: AbortSignal) => Promise<Omit<Candidate, 'id'>>
	/** The machine supplies its own spawn; this binding never owns an actor lifecycle. */
	spawnSave: (spawn: SaveSpawner, request: SaveRequest) => SaveRef
	read: ReadCapabilities
	subscribe: (next: (rows: DocumentHeader[]) => void, error: () => void) => () => void
}
export type LibraryEvent =
	| ReadReport
	| { type: 'ADD'; url: string }
	| { type: 'CANCEL' | 'SHUTDOWN' | 'CLOSE_READER' }
	| { type: 'OPEN'; id: string }
	| { type: 'ROWS'; rows: DocumentHeader[] }
	| { type: 'LIST_FAILED' }
	| SyncReport
