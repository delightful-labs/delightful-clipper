import type { Article, LibraryArticle } from '../contracts/articles.js'
import type { DocumentHeader } from '../contracts/storage.js'
/** Deterministic row projection; subscription lifetime belongs to the collection actor. */
export function projectLibraryArticles(
	articles: Article[],
	documents: DocumentHeader[]
): LibraryArticle[] {
	const docs = new Map(documents.map((d) => [d.id, d]))
	const output = new Map<string, LibraryArticle>()
	for (const a of [...articles].sort(
		(a, b) => a.originalSavedAt.localeCompare(b.originalSavedAt) || a.id.localeCompare(b.id)
	)) {
		const d = a.contentId ? docs.get(a.contentId) : undefined
		const key = a.contentId ?? a.id
		if (!output.has(key))
			output.set(key, {
				id: a.id,
				title: d?.title ?? a.url,
				url: a.url,
				contentId: a.contentId,
				originalSavedAt: a.originalSavedAt,
				failure: a.failure
			})
		if (a.contentId) docs.delete(a.contentId)
	}
	for (const d of docs.values())
		if (!output.has(d.id))
			output.set(d.id, {
				id: d.id,
				title: d.title,
				url: null,
				contentId: d.id,
				originalSavedAt: d.originalSavedAt,
				failure: null
			})
	return [...output.values()].sort(
		(a, b) => b.originalSavedAt.localeCompare(a.originalSavedAt) || a.id.localeCompare(b.id)
	)
}
