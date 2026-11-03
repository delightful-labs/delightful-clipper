const articleIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export const isArticleId = (id: string) => articleIdPattern.test(id)
export const articleHref = (id: string) => `/articles/${encodeURIComponent(id)}`
export const isArticlePath = (path: string) => {
	const parts = path.split('/')
	return parts.length === 3 && parts[1] === 'articles' && isArticleId(parts[2] ?? '')
}
