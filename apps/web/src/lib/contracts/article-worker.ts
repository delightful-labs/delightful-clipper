import type { Article, ArticleSaveResult, SaveArticleRequest } from './articles.js'
import type { WorkflowMessage } from './feedback.js'
export type SavedReply = { kind: ArticleSaveResult['kind']; operationId: string; ready: boolean }
export type WorkerCall =
	| { type: 'CALL'; id: string; method: 'resolve' | 'extract'; url: string; requestId: string }
	| { type: 'CALL'; id: string; method: 'document' | 'intent'; operationId: string }
	| { type: 'CALL'; id: string; method: 'save'; request: SaveArticleRequest }
	| { type: 'CALL'; id: string; method: 'fail'; articleId: string; code: string }
export type RpcReply =
	| { method: 'resolve' | 'extract'; bytes: Uint8Array; status: number }
	| { method: 'document' | 'intent'; exists: boolean }
	| { method: 'save'; result: SavedReply }
	| { method: 'fail' }
export type WorkerInput =
	| { type: 'INIT'; libraryId: string; debug: boolean }
	| { type: 'ROWS'; rows: Article[] }
	| { type: 'REPLY'; id: string; reply: RpcReply }
	| { type: 'ERROR'; id: string; code: string }
	| { type: 'STOP' | 'WAKE' }
	| { type: 'CANCEL' | 'RETRY'; id: string }
export type WorkerOutput =
	| WorkerCall
	| { type: 'CANCEL_CALL'; id: string }
	| { type: 'STATUS'; id: string; message: WorkflowMessage; cancelable: boolean }
export type QueueReport =
	| { type: 'BACKGROUND_STATUS'; id: string; message: WorkflowMessage; cancelable: boolean }
	| { type: 'BACKGROUND_SAVED'; result: ArticleSaveResult }
	| { type: 'BACKGROUND_CLOSED' }
	| { type: 'BACKGROUND_ERROR' }
export type QueueControl = { type: 'STOP' | 'WAKE' } | { type: 'CANCEL' | 'RETRY'; id: string }
export type QueueResource = { send: (event: QueueControl) => void; stop: () => Promise<void> }
export type QueueOpen = (report: (event: QueueReport) => void) => QueueResource
export type QueueCapability = {
	libraryId: string
	resolve: (url: string, id: string, signal: AbortSignal) => Promise<string>
	extract: (
		url: string,
		id: string,
		signal: AbortSignal
	) => Promise<import('../capture/source.js').Candidate>
	document: (id: string, signal: AbortSignal) => Promise<boolean>
	intent: (id: string, signal: AbortSignal) => Promise<boolean>
	save: (request: SaveArticleRequest) => Promise<SavedReply>
	fail: (id: string, code: string) => Promise<void>
	report: (event: Extract<WorkerOutput, { type: 'STATUS' }>) => void
}
