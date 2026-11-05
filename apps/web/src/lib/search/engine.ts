import MiniSearch from 'minisearch'
import { caseFold } from 'unicode-case-folding'
import type { SearchDocument } from './schema.js'
export type { SearchDocument } from './schema.js'
export const searchOptions = {
	fields: ['title', 'url', 'text', 'tags'],
	storeFields: ['originalSavedAt'],
	processTerm: (term: string) => caseFold(term.normalize('NFC')),
	searchOptions: { combineWith: 'AND' as const, boost: { title: 2 }, prefix: false, fuzzy: false }
}
export async function buildIndex(documents: SearchDocument[]) {
	const index = new MiniSearch<SearchDocument>(searchOptions)
	await index.addAllAsync(documents, { chunkSize: 100 })
	return index
}
export function restoreIndex(serialized: string) {
	return MiniSearch.loadJSON<SearchDocument>(serialized, searchOptions)
}
export function searchIndex(index: MiniSearch<SearchDocument>, query: string): string[] {
	return index
		.search(query)
		.sort(
			(a, b) =>
				b.score - a.score ||
				String(b.originalSavedAt).localeCompare(String(a.originalSavedAt)) ||
				String(a.id).localeCompare(String(b.id))
		)
		.map((result) => String(result.id))
}
export async function searchFingerprint(documents: SearchDocument[]) {
	const bytes = new TextEncoder().encode(JSON.stringify(documents))
	return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (byte) =>
		byte.toString(16).padStart(2, '0')
	).join('')
}
