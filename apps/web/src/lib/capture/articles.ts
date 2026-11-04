import { articleSchema } from './article-schema.js'
import { lowercaseUuidSchema } from '../validation/values.js'
import { articleId, normalizedSource } from './source.js'
import type { Article, ArticleDraft, SaveArticleRequest } from '../contracts/articles.js'
export function uuid(value: unknown): string {
	const parsed = lowercaseUuidSchema.safeParse(value)
	if (!parsed.success) throw new Error('invalidRecord')
	return parsed.data
}
export function articleRecord(value: unknown, libraryId: string): Article {
	const parsed = articleSchema.safeParse(value)
	if (!parsed.success || parsed.data.libraryId !== libraryId) throw new Error('invalidRecord')
	normalizedSource(parsed.data.url)
	return parsed.data
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
