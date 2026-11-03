import { createActor, toPromise } from 'xstate'
import type { LibraryCapability } from '../../contracts/library.js'
import {
	articleId,
	extractedCandidate,
	normalizedSource,
	resolvedUrl
} from '../../capture/source.js'
import type { LibraryRecords } from './records.js'
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
		prepare: async (url, signal) => {
			normalizedSource(url)
			const requestId = crypto.randomUUID()
			const resolved = resolvedUrl(await json('resolve', url, requestId, signal), requestId)
			const lookup = async (finalUrl: string) => {
				const id = await articleId(libraryId, finalUrl)
				current(signal)
				const state = await records.lookup(id)
				current(signal)
				return { id, state }
			}
			const first = await lookup(resolved)
			if (first.state !== 'missing')
				return { kind: first.state === 'available' ? 'duplicate' : 'uncertain', id: first.id }
			const candidate = extractedCandidate(
				await json('extract', url, requestId, signal),
				requestId,
				url
			)
			const final = await lookup(candidate.finalUrl)
			if (final.state !== 'missing')
				return { kind: final.state === 'available' ? 'duplicate' : 'uncertain', id: final.id }
			return { kind: 'preview', candidate: { ...candidate, id: final.id } }
		},
		save: async (request, signal) => {
			current(signal)
			const actor = createActor(records.saveMachine, { input: request })
			const abort = () => actor.send({ type: 'SHUTDOWN' })
			signal.addEventListener('abort', abort, { once: true })
			try {
				actor.start()
				if (signal.aborted) abort()
				return await toPromise(actor)
			} finally {
				signal.removeEventListener('abort', abort)
				actor.stop()
			}
		}
	}
}
