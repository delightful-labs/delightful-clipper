import type { LibraryArticle } from './articles.js'
import type { SearchDocument } from '../search/schema.js'
import type { SearchWorkerInput, SearchWorkerOutput } from '../search/protocol.js'
export type SearchResource = { post: (message: SearchWorkerInput) => void; dispose: () => void }
export type SearchCapability = {
	libraryId: string
	isCurrent: () => boolean
	load: (rows: LibraryArticle[], signal: AbortSignal) => Promise<SearchDocument[]>
	observe: (dirty: () => void, error: () => void) => () => void
	open: (report: (event: SearchWorkerOutput) => void) => SearchResource
}
