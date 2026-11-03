import type { Candidate } from '../capture/source.js'
import type { DocumentHeader, ReadResult, SaveRequest, SaveResult, SyncReceipt } from './storage.js'
export type CapturePreparation =
	| { kind: 'preview'; candidate: Candidate }
	| { kind: 'duplicate' | 'uncertain'; id: string }
export type LibraryCapability = {
	isCurrent: () => boolean
	prepare: (url: string, signal: AbortSignal) => Promise<CapturePreparation>
	save: (request: SaveRequest, signal: AbortSignal) => Promise<SaveResult>
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
