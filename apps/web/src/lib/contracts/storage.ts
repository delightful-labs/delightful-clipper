import type { ActorLogic, Snapshot } from 'xstate'
import type {
	WorkspaceCreationAttempt,
	WorkspaceCreationResult
} from 'delightful-local-first/workspace/creation/contracts'

export type SaveRequest = {
	operationId: string
	title: string
	text: string
	bytes: Uint8Array
	mediaType: string
}
export type SyncReceipt = { global: () => Promise<void> }
export type Part = {
	id: string
	libraryId: string
	manifestId: string
	ordinal: number
	byteLength: number
	hash: string
	payload: Uint8Array
}
export type Manifest = {
	id: string
	libraryId: string
	operationId: string
	mediaType: string
	encoding: string
	byteLength: number
	originalByteLength: number
	partCount: number
	hash: string
}
export type TextSnapshot = {
	id: string
	libraryId: string
	documentId: string
	text: string
	hash: string
	formatVersion: string
}
export type DocumentHeader = {
	id: string
	libraryId: string
	operationId: string
	snapshotId: string
	manifestId: string
	title: string
	originalSavedAt: string
}
export type StorageIntent = {
	id: string
	libraryId: string
	payloadHash: string
	createdAt: string
}
export type PreparedSave = {
	intent: StorageIntent
	manifest: Manifest
	parts: Part[]
	snapshot: TextSnapshot
	document: DocumentHeader
}
export type SaveResult =
	| { kind: 'saved'; operationId: string; receipts: SyncReceipt[] }
	| { kind: 'failed' | 'unknown' | 'interrupted' | 'scopeChanged' | 'blocked'; operationId: string }
export type StageResult = WorkspaceCreationResult<PreparedSave, SyncReceipt>
export type StageLogic<S extends Snapshot<StageResult>> = ActorLogic<
	S,
	{ type: 'SHUTDOWN' | 'CANCEL' },
	{ attempt: WorkspaceCreationAttempt<PreparedSave> }
>
export type SaveCapabilities<S extends Snapshot<StageResult>> = {
	isCurrent: () => boolean
	prepare: (request: SaveRequest) => Promise<PreparedSave>
	intent: StageLogic<S>
	parts: StageLogic<S>
	publish: StageLogic<S>
	readParts: (id: string) => Promise<Part[]>
	verify: (input: { manifest: Manifest; parts: Part[] }) => Promise<void>
}
export type AssetResult =
	| { kind: 'available'; bytes: Uint8Array; mediaType: string }
	| { kind: 'unavailable'; reason: 'missingParts' | 'integrityMismatch' }
export type ReadResult =
	| { kind: 'missing' | 'unavailable' | 'corrupt' }
	| { kind: 'available'; document: DocumentHeader; text: string; asset: AssetResult }
export type ReadCapabilities = {
	isCurrent: () => boolean
	document: (id: string) => Promise<DocumentHeader | null>
	snapshot: (id: string) => Promise<TextSnapshot | null>
	manifest: (id: string) => Promise<Manifest | null>
	parts: (id: string) => Promise<Part[]>
	verifyText: (snapshot: TextSnapshot) => Promise<boolean>
	decode: (input: { manifest: Manifest; parts: Part[] }) => Promise<Uint8Array>
}
