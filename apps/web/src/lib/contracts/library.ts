import type { OrganizationRequest, LibraryView } from '../capture/organization.js'
import type { ActorLogic, ActorRef, Snapshot } from 'xstate'
import type { ArticleSaveResult, LibraryArticle, SaveArticleRequest } from './articles.js'
import type { QueueOpen, QueueReport } from './article-worker.js'
import type { ReadCapabilities, ReadReport, SyncReport } from './storage.js'
export type SaveRef = ActorRef<Snapshot<ArticleSaveResult>, { type: 'SHUTDOWN' }>
export type SaveSpawner = <S extends Snapshot<ArticleSaveResult>>(
	logic: ActorLogic<S, { type: 'SHUTDOWN' }, SaveArticleRequest>,
	options: { input: SaveArticleRequest }
) => ActorRef<S, { type: 'SHUTDOWN' }>
export type OrganizationSpawner = <S extends Snapshot<ArticleSaveResult>>(
	logic: ActorLogic<S, { type: 'SHUTDOWN' }, OrganizationRequest>,
	options: { input: OrganizationRequest }
) => ActorRef<S, { type: 'SHUTDOWN' }>
export type LibraryCapability = {
	spawnOrganization?: (spawn: OrganizationSpawner, request: OrganizationRequest) => SaveRef
	libraryId: string
	isCurrent: () => boolean
	spawnSave: (spawn: SaveSpawner, request: SaveArticleRequest) => SaveRef
	read: ReadCapabilities
	subscribe: (next: (rows: LibraryArticle[]) => void, error: () => void) => () => void
	worker: QueueOpen
}
export type LibraryEvent =
	| { type: 'ORGANIZE'; request: OrganizationRequest }
	| { type: 'FILTER'; view: LibraryView; favorites: boolean }
	| ReadReport
	| SyncReport
	| QueueReport
	| ({ type: 'ADD' } & SaveArticleRequest)
	| { type: 'CANCEL' | 'SHUTDOWN' | 'CLOSE_READER' }
	| { type: 'OPEN' | 'RETRY'; id: string }
	| { type: 'ROWS'; rows: LibraryArticle[] }
	| { type: 'LIST_FAILED' }
