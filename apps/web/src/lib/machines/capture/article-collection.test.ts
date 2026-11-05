import { expect, it, vi } from 'vitest'
import { createActor } from 'xstate'
import type { Article } from '../../contracts/articles.js'
import type { DocumentHeader } from '../../contracts/storage.js'
import { createArticleCollectionMachine } from './article-collection.js'
const article: Article = {
	id: 'article',
	libraryId: 'library',
	url: 'https://example.com',
	originalSavedAt: '2026-11-03',
	contentId: 'content',
	operationId: null,
	failure: null
}
const document: DocumentHeader = {
	id: 'content',
	libraryId: 'library',
	operationId: 'operation',
	snapshotId: 'snapshot',
	assetId: 'asset',
	title: 'Saved title',
	originalSavedAt: '2026-11-02'
}
function fixture() {
	let articles: (rows: Article[]) => void = () => {}
	let documents: (rows: DocumentHeader[]) => void = () => {}
	let fail: () => void = () => {}
	let current = true
	const releaseArticles = vi.fn(),
		releaseDocuments = vi.fn(),
		releaseTags = vi.fn(),
		next = vi.fn(),
		error = vi.fn()
	const actor = createActor(
		createArticleCollectionMachine({
			isCurrent: () => current,
			articles: (update, error) => {
				articles = update
				fail = error
				update([article])
				return releaseArticles
			},
			tags: () => releaseTags,
			documents: (update) => {
				documents = update
				return releaseDocuments
			}
		}),
		{ input: { next, error } }
	).start()
	return {
		actor,
		next,
		error,
		releaseArticles,
		releaseDocuments,
		releaseTags,
		articles: (rows: Article[]) => articles(rows),
		documents: (rows: DocumentHeader[]) => documents(rows),
		fail: () => fail(),
		stale: () => {
			current = false
		}
	}
}
it('joins independent updates, deduplicates content, preserves legacy documents and deterministic ordering', () => {
	const f = fixture()
	expect(f.next).toHaveBeenLastCalledWith([expect.objectContaining({ title: article.url })])
	f.documents([document, { ...document, id: 'legacy', title: 'Legacy' }])
	f.articles([{ ...article, id: 'later', originalSavedAt: '2026-11-04' }, article])
	expect(f.next).toHaveBeenLastCalledWith([
		expect.objectContaining({ id: 'article', title: 'Saved title' }),
		expect.objectContaining({ id: 'legacy', contentId: 'legacy', url: null })
	])
	f.actor.send({ type: 'STOP' })
	expect(f.releaseArticles).toHaveBeenCalledOnce()
	expect(f.releaseDocuments).toHaveBeenCalledOnce()
	expect(f.releaseTags).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().context).toEqual({
		articles: [],
		documents: [],
		organization: [],
		tags: [],
		callbacks: undefined
	})
	const calls = f.next.mock.calls.length
	f.documents([])
	expect(f.next).toHaveBeenCalledTimes(calls)
})
it('fails once and releases both subscriptions before ignoring late callbacks', () => {
	const f = fixture()
	f.fail()
	f.fail()
	expect(f.error).toHaveBeenCalledOnce()
	expect(f.releaseArticles).toHaveBeenCalledOnce()
	expect(f.releaseDocuments).toHaveBeenCalledOnce()
	expect(f.releaseTags).toHaveBeenCalledOnce()
})
it('suppresses updates and errors after the account binding expires', () => {
	const f = fixture()
	const calls = f.next.mock.calls.length
	f.stale()
	f.documents([document])
	f.fail()
	expect(f.next).toHaveBeenCalledTimes(calls)
	expect(f.error).not.toHaveBeenCalled()
	expect(f.releaseArticles).toHaveBeenCalledOnce()
})
it('releases the first subscription if opening the second throws', () => {
	const release = vi.fn(),
		error = vi.fn()
	createActor(
		createArticleCollectionMachine({
			isCurrent: () => true,
			articles: () => release,
			documents: () => {
				throw new Error('subscription failed')
			}
		}),
		{ input: { next: () => {}, error } }
	).start()
	expect(error).toHaveBeenCalledOnce()
	expect(release).toHaveBeenCalledOnce()
})
