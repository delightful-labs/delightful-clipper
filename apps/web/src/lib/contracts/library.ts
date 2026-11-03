import type { ActorLogic, ActorRef, Snapshot } from 'xstate'
import type { Candidate } from '../capture/source.js'
import type { DocumentHeader, ReadResult, SaveRequest, SaveResult, SyncReceipt } from './storage.js'
export type CapturePreparation =
	| { kind: 'preview'; candidate: Candidate }
	| { kind: 'duplicate' | 'uncertain'; id: string }
	| { kind: 'scopeChanged' }
export type SaveRef = ActorRef<Snapshot<SaveResult>, { type: 'SHUTDOWN' }>
export type SaveSpawner = <S extends Snapshot<SaveResult>>(
	logic: ActorLogic<S, { type: 'SHUTDOWN' }, SaveRequest>,
	options: { id: string; input: SaveRequest }
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
	read: (id: string, signal: AbortSignal) => Promise<ReadResult>
	subscribe: (next: (rows: DocumentHeader[]) => void, error: () => void) => () => void
}
export type LibraryEvent =
	| { type: 'ADD'; url: string }
	| { type: 'SAVE' | 'CANCEL' | 'SHUTDOWN' | 'CLOSE_READER' }
	| { type: 'OPEN'; id: string }
	| { type: 'ROWS'; rows: DocumentHeader[] }
	| { type: 'LIST_FAILED' }
	| { type: 'SYNC'; id: string; status: 'accepted' | 'rejected' }
export type ReceiptWatch = { type: 'WATCH'; id: string; receipts: SyncReceipt[] }
