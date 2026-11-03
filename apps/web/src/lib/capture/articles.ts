import { articleId, normalizedSource } from './source.js'
import type { Article, ArticleDraft, SaveArticleRequest } from '../contracts/articles.js'
export function uuid(value: unknown): string {
	if (
		typeof value !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
	)
		throw new Error('invalidRecord')
	return value
}
export function articleRecord(value: Article, libraryId: string): Article {
	if (
		value.libraryId !== libraryId ||
		value.url.length > 8192 ||
		!Number.isFinite(Date.parse(value.originalSavedAt)) ||
		(value.failure !== null && value.failure.length > 100)
	)
		throw new Error('invalidRecord')
	uuid(value.id)
	normalizedSource(value.url)
	if (value.contentId !== null) uuid(value.contentId)
	if (value.operationId !== null) uuid(value.operationId)
	return { ...value }
}
export async function prepareArticle(
	libraryId: string,
	request: SaveArticleRequest
): Promise<ArticleDraft> {
	normalizedSource(request.url)
	const id = await articleId(libraryId, request.url)
	const target = request.contentId
		? uuid(request.contentId)
		: await articleId(libraryId, request.content?.finalUrl ?? request.url)
	const article: Article = {
		id,
		libraryId,
		url: request.url,
		originalSavedAt: new Date().toISOString(),
		contentId: null,
		operationId: null,
		failure: null
	}
	return {
		article,
		target,
		...(request.content
			? {
					content: {
						articleId: id,
						operationId: target,
						title: request.content.title,
						text: request.content.text,
						bytes: new TextEncoder().encode(request.content.html),
						mediaType: 'text/html',
						source: {
							submittedUrl: request.url,
							finalUrl: normalizedSource(request.content.finalUrl),
							provenance: request.content.provenance
						}
					}
				}
			: {})
	}
}
