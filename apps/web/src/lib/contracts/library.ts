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
export type FakeDataRef = ActorRef<
	Snapshot<import('../samples/machine.js').FakeDataOutcome>,
	{ type: 'SHUTDOWN' }
>
export type FakeDataSpawner = <S extends Snapshot<import('../samples/machine.js').FakeDataOutcome>>(
	logic: ActorLogic<S, { type: 'SHUTDOWN' }, undefined>,
	options: { input: undefined }
) => FakeDataRef
export type LibraryCapability = {
	images?: import('./images.js').ImageCapability
	reader?: import('./reader.js').ReaderCapability
	spawnFakeData?: (spawn: FakeDataSpawner) => FakeDataRef
	search?: import('./search.js').SearchCapability
	spawnOrganization?: (spawn: OrganizationSpawner, request: OrganizationRequest) => SaveRef
	libraryId: string
	isCurrent: () => boolean
	spawnSave: (spawn: SaveSpawner, request: SaveArticleRequest) => SaveRef
	read: ReadCapabilities
	subscribe: (next: (rows: LibraryArticle[]) => void, error: () => void) => () => void
	worker: QueueOpen
}
export type LibraryEvent =
	| { type: 'RETRY_IMAGE'; id: string }
	| { type: 'IMAGE_ERROR'; id: string; url: string }
	| {
			type: 'READER_EVENT'
			event: import('../machines/reader/experience.js').ReaderExperienceEvent
	  }
	| { type: 'ORGANIZE'; request: OrganizationRequest }
	| { type: 'FILTER'; view: LibraryView; favorites: boolean }
	| { type: 'TAG_FILTER'; keys: string[] }
	| { type: 'QUERY'; query: string }
	| { type: 'RETRY_SEARCH' }
	| { type: 'SEARCH_OPEN' }
	| ReadReport
	| SyncReport
	| QueueReport
	| ({ type: 'ADD' } & SaveArticleRequest)
	| { type: 'CANCEL' }
	| { type: 'SHUTDOWN' }
	| { type: 'CLOSE_READER' }
	| { type: 'OPEN'; id: string }
	| { type: 'RETRY'; id: string }
	| { type: 'ROWS'; rows: LibraryArticle[] }
	| { type: 'LIST_FAILED' }
