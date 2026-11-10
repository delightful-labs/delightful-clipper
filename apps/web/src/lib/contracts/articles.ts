import type { Snapshot } from 'xstate'
import type { ArticleMetadata } from '../capture/metadata.js'
import type { WorkspaceCreationResult } from 'delightful-local-first/workspace/creation/contracts'
import type { SaveRequest, SaveResult, SyncReceipt, DocumentHeader } from './storage.js'
export type { Article } from '../capture/article-schema.js'
import type { Article } from '../capture/article-schema.js'
export type ArticleContent = ArticleMetadata & {
	title: string
	text: string
	html: string
	finalUrl: string
	provenance: string
}
/** Both Add Link and a trusted browser clip use this operation. Content is optional. */
export type SaveArticleRequest = { url: string; content?: ArticleContent; contentId?: string }
export type ArticleSaveResult =
	| (SaveResult & { ready?: boolean })
	| { kind: 'duplicate'; operationId: string; ready: boolean; receipts: SyncReceipt[] }
export type ArticleDraft = { article: Article; content?: SaveRequest; target: string }
export type ArticleStageResult = WorkspaceCreationResult<ArticleDraft, SyncReceipt>
export type ArticleStageInput = {
	attempt: { operationId: string; workspaceId: string; membershipId: string; draft: ArticleDraft }
}
export type ArticleStageOperation = (
	spawn: import('../machines/children.js').ChildSpawner,
	input: ArticleStageInput
) => import('xstate').ActorInstance<Snapshot<ArticleStageResult>, { type: 'SHUTDOWN' | 'CANCEL' }>
export type ContentOperation = (
	spawn: import('../machines/children.js').ChildSpawner,
	input: SaveRequest
) => import('xstate').ActorInstance<Snapshot<SaveResult>, { type: 'SHUTDOWN' }>
export type ArticleSaveCapability = {
	isCurrent: () => boolean
	prepare: (request: SaveArticleRequest) => Promise<ArticleDraft>
	read: (id: string) => Promise<Article | null>
	document: (id: string) => Promise<DocumentHeader | null>
	intent: (id: string) => Promise<boolean>
	ensure: ArticleStageOperation
	attach: ArticleStageOperation
	content: ContentOperation
}
export type LibraryArticle = {
	excerpt?: string
	readingProgress?: number | undefined
	trashed?: boolean
	tags?: import('../capture/tags.js').Tag[]
	tagVocabulary?: import('../capture/tags.js').Tag[]
	status?: 'inbox' | 'later' | 'archive'
	favorite?: boolean
	id: string
	title: string
	url: string | null
	contentId: string | null
	originalSavedAt: string
	failure: string | null
}
