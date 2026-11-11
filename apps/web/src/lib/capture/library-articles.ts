import type { Article, LibraryArticle } from '../contracts/articles.js'
import type { DocumentHeader, SnapshotPreview } from '../contracts/storage.js'
import { makeExcerpt } from './excerpt.js'
/** Deterministic row projection; subscription lifetime belongs to the collection actor. */
export function projectLibraryArticles(
	articles: Article[],
	documents: DocumentHeader[],
	previews: SnapshotPreview[] = []
): LibraryArticle[] {
	const docs = new Map(documents.map((d) => [d.id, d]))
	const output = new Map<string, LibraryArticle>()
	const snapshots = new Map(previews.map((preview) => [preview.id, preview]))
	const excerptFor = (document: DocumentHeader | undefined) => {
		const snapshot = document && snapshots.get(document.snapshotId)
		return snapshot
			? makeExcerpt(snapshot.excerpt?.trim() ? snapshot.excerpt : snapshot.text, document?.title)
			: ''
	}
	for (const a of [...articles].sort(
		(a, b) => a.originalSavedAt.localeCompare(b.originalSavedAt) || a.id.localeCompare(b.id)
	)) {
		const d = a.contentId ? docs.get(a.contentId) : undefined
		const key = a.contentId ?? a.id
		const excerpt = excerptFor(d)
		if (!output.has(key))
			output.set(key, {
				id: a.id,
				readingProgress: 0,
				title: d?.title ?? a.url,
				...(excerpt ? { excerpt } : {}),
				url: a.url,
				contentId: a.contentId,
				originalSavedAt: a.originalSavedAt,
				failure: a.failure
			})
		if (a.contentId) docs.delete(a.contentId)
	}
	for (const d of docs.values()) {
		const excerpt = excerptFor(d)
		if (!output.has(d.id))
			output.set(d.id, {
				id: d.id,
				readingProgress: 0,
				title: d.title,
				...(excerpt ? { excerpt } : {}),
				url: null,
				contentId: d.id,
				originalSavedAt: d.originalSavedAt,
				failure: null
			})
	}
	return [...output.values()].sort(
		(a, b) => b.originalSavedAt.localeCompare(a.originalSavedAt) || a.id.localeCompare(b.id)
	)
}
