import type { Article } from '../contracts/articles.js'
import type { PreparedSave } from '../contracts/storage.js'
type SaveTarget = Pick<PreparedSave, 'articleId' | 'source'>

export function isPendingArticle(article: Article | null | undefined): article is Article {
	return article != null && article.contentId === null
}

function isPendingArticleForSource(
	article: Article | null,
	source: SaveTarget['source']
): article is Article {
	return isPendingArticle(article) && article.url === source?.submittedUrl
}

/** A new intent may create an article or bind a matching, unreserved pending article. */
export function canBindArticleIntent(article: Article | null, target: SaveTarget) {
	if (!target.articleId) return true
	if (!target.source) return false
	if (article === null) return true
	return isPendingArticleForSource(article, target.source) && article.operationId === null
}

/** Publication must complete the pending article already bound to this exact operation. */
export function canPublishArticleContent(
	article: Article | null,
	target: SaveTarget,
	operationId: string
) {
	if (!target.articleId) return true
	return isPendingArticleForSource(article, target.source) && article.operationId === operationId
}

export function canAttachArticleContent(article: Article | null, contentAvailable: boolean) {
	if (!contentAvailable) return false
	if (article === null) return true
	return isPendingArticle(article)
}
