import type { LibraryCapability } from '../../contracts/library.js'
import {
	articleId,
	extractedCandidate,
	normalizedSource,
	resolvedUrl
} from '../../capture/source.js'
import type { LibraryRecords } from './records.js'
/** Individual I/O leaves; capture sequencing and actor lifetime belong to machines. */
export function createLibraryCapability(
	records: LibraryRecords,
	libraryId: string,
	request: (mode: 'resolve' | 'extract', body: unknown, signal: AbortSignal) => Promise<Response>
): LibraryCapability {
	const current = (signal: AbortSignal) => {
		signal.throwIfAborted()
		if (!records.isCurrent()) throw new Error('scopeChanged')
	}
	async function json(mode: 'resolve' | 'extract', url: string, id: string, signal: AbortSignal) {
		current(signal)
		normalizedSource(url)
		const response = await request(mode, { protocolVersion: 1, operationId: id, url }, signal)
		const data: unknown = await response.json()
		current(signal)
		if (!response.ok)
			throw new Error(
				response.status === 401
					? 'sessionUnavailable'
					: response.status === 429
						? 'rateLimited'
						: 'captureFailed'
			)
		return data
	}
	return {
		isCurrent: records.isCurrent,
		subscribe: records.subscribe,
		read: records.read,
		spawnSave: (spawn, input) => spawn(records.saveMachine, { id: 'save', input }),
		resolve: async (url, id, signal) => resolvedUrl(await json('resolve', url, id, signal), id),
		identify: async (url, signal) => {
			current(signal)
			const id = await articleId(libraryId, url)
			current(signal)
			return id
		},
		hasDocument: async (id, signal) => {
			current(signal)
			const found = await records.hasDocument(id)
			current(signal)
			return found
		},
		hasIntent: async (id, signal) => {
			current(signal)
			const found = await records.hasIntent(id)
			current(signal)
			return found
		},
		extract: async (url, id, signal) =>
			extractedCandidate(await json('extract', url, id, signal), id, url)
	}
}
