import { isUuid } from '../validation/values.ts'
export const isArticleId = (id: string) => isUuid(id)
export const articleHref = (id: string) => `/articles/${encodeURIComponent(id)}`
export const isArticlePath = (path: string) => {
	const parts = path.split('/')
	return parts.length === 3 && parts[1] === 'articles' && isArticleId(parts[2] ?? '')
}
