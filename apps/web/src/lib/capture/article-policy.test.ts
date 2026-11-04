import { expect, it } from 'vitest'
import type { Article } from '../contracts/articles.js'
import type { PreparedSave } from '../contracts/storage.js'
import {
	canAttachArticleContent,
	canBindArticleIntent,
	canPublishArticleContent,
	isPendingArticle
} from './article-policy.js'
const pending: Article = {
	id: 'article',
	libraryId: 'library',
	url: 'https://example.com/',
	originalSavedAt: '2026-11-04',
	contentId: null,
	operationId: null,
	failure: null
}
const target: Pick<PreparedSave, 'articleId' | 'source'> = {
	articleId: pending.id,
	source: {
		id: 'source',
		libraryId: 'library',
		documentId: 'content',
		finalUrl: pending.url,
		submittedUrl: pending.url,
		provenance: '{}'
	}
}
it.each([
	{ article: null, bind: true, publish: false },
	{ article: pending, bind: true, publish: false },
	{ article: { ...pending, operationId: 'operation' }, bind: false, publish: true },
	{ article: { ...pending, operationId: 'other' }, bind: false, publish: false },
	{ article: { ...pending, url: 'https://other.example/' }, bind: false, publish: false },
	{
		article: { ...pending, contentId: 'content', operationId: 'operation' },
		bind: false,
		publish: false
	}
])('checks binding and publication independently for $article', ({ article, bind, publish }) => {
	expect(canBindArticleIntent(article, target)).toBe(bind)
	expect(canPublishArticleContent(article, target, 'operation')).toBe(publish)
})
it('allows standalone content but requires source metadata for an article target', () => {
	expect(canBindArticleIntent(null, {})).toBe(true)
	expect(canPublishArticleContent(null, {}, 'operation')).toBe(true)
	expect(canBindArticleIntent(null, { articleId: pending.id })).toBe(false)
	expect(
		canPublishArticleContent(
			{ ...pending, operationId: 'operation' },
			{ articleId: pending.id },
			'operation'
		)
	).toBe(false)
})
it('requires available content and preserves completed articles during attachment', () => {
	expect(canAttachArticleContent(null, true)).toBe(true)
	expect(canAttachArticleContent(pending, true)).toBe(true)
	expect(canAttachArticleContent(pending, false)).toBe(false)
	expect(canAttachArticleContent(null, false)).toBe(false)
	expect(canAttachArticleContent({ ...pending, contentId: 'content' }, true)).toBe(false)
	expect(isPendingArticle(null)).toBe(false)
	expect(isPendingArticle(undefined)).toBe(false)
})
