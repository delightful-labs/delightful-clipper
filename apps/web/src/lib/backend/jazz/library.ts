import type { LibraryCapability } from '../../contracts/library.js'
import { articleWorkerOpen } from '../../machines/capture/article-worker-host.js'
import type { LibraryRecords } from './records.js'
/** Binding only. The library owns saving, worker lifetime and SDK leaf resources. */
export function createLibraryCapability(
	records: LibraryRecords,
	_libraryId: string,
	request: (mode: 'resolve' | 'extract', body: unknown, signal: AbortSignal) => Promise<Response>
): LibraryCapability {
	return {
		isCurrent: records.isCurrent,
		read: records.readCapabilities,
		subscribe: records.articles.subscribe,
		spawnSave: (spawn, input) => spawn(records.articles.saveMachine, { input }),
		worker: articleWorkerOpen(records, request)
	}
}
