import type { ActorRef, Snapshot } from 'xstate'
import type { ArticleMetadata } from '../capture/metadata.js'
import type {
	WorkspaceCreationAttempt,
	WorkspaceCreationResult
} from 'delightful-local-first/workspace/creation/contracts'

export type { SaveRequest } from '../storage/policy.js'
import type { SaveRequest, SourceMetadata } from '../storage/policy.js'
export type ArticleSource = SourceMetadata & {
	documentId: string
	id: string
	libraryId: string
}
export type SyncReport = { type: 'SYNC'; id: string; status: 'accepted' | 'rejected' }
export type ReceiptWatch = { type: 'WATCH'; id: string; receipts: SyncReceipt[] }
export type SyncReceipt = { global: () => Promise<void> }
export type StoredAsset = {
	id: string
	libraryId: string
	operationId: string
	mediaType: string
	payload: Uint8Array
}
type StoredArticleMetadata = {
	[K in keyof ArticleMetadata]?: Exclude<ArticleMetadata[K], undefined>
}
export type TextSnapshot = StoredArticleMetadata & {
	id: string
	libraryId: string
	documentId: string
	text: string
	formatVersion: string
}
export type DocumentHeader = {
	id: string
	libraryId: string
	operationId: string
	snapshotId: string
	assetId: string
	title: string
	originalSavedAt: string
}
export type SnapshotPreview = Pick<TextSnapshot, 'id' | 'text' | 'excerpt'>
export type StorageIntent = {
	id: string
	libraryId: string
	payloadHash: string
	createdAt: string
}
export type PreparedSave = {
	images?: import('../images/schema.js').ArticleImage[]
	articleId?: string
	source?: ArticleSource
	intent: StorageIntent
	asset: StoredAsset
	snapshot: TextSnapshot
	document: DocumentHeader
}
export type SaveResult =
	| { kind: 'saved'; operationId: string; receipts: SyncReceipt[] }
	| { kind: 'failed' | 'unknown' | 'interrupted' | 'scopeChanged' | 'blocked'; operationId: string }
export type StageResult = WorkspaceCreationResult<PreparedSave, SyncReceipt>
export type StageInput = { attempt: WorkspaceCreationAttempt<PreparedSave> }
export type StageRef = import('xstate').ActorInstance<
	Snapshot<StageResult>,
	{ type: 'SHUTDOWN' | 'CANCEL' }
>
export type StageOperation = (
	spawn: import('../machines/children.js').ChildSpawner,
	input: StageInput
) => StageRef
export type SaveCapabilities = {
	isCurrent: () => boolean
	prepare: (request: SaveRequest) => Promise<PreparedSave>
	intent: StageOperation
	publish: StageOperation
}
export type AssetResult =
	| { kind: 'available'; bytes: Uint8Array; mediaType: string }
	| { kind: 'unavailable'; reason: 'missing' | 'invalid' }
export type ReadResult =
	| { kind: 'missing' | 'unavailable' | 'corrupt' }
	| {
			kind: 'available'
			document: DocumentHeader
			text: string
			asset: AssetResult
			source?: ArticleSource
	  }
export type ReadOutcome = { kind: ReadResult['kind'] }
export type ReadReport = { type: 'READ_RESULT'; generation: number; result: ReadResult }
export type ReadInput = {
	id: string
	capability: ReadCapabilities
	generation?: number
	reportTo?: ActorRef<Snapshot<unknown>, ReadReport>
}
export type ReadCapabilities = {
	isCurrent: () => boolean
	document: (id: string, signal: AbortSignal) => Promise<DocumentHeader | null>
	snapshot: (id: string, signal: AbortSignal) => Promise<TextSnapshot | null>
	asset: (id: string, signal: AbortSignal) => Promise<StoredAsset | null>
	source: (id: string, signal: AbortSignal) => Promise<ArticleSource | null>
}
