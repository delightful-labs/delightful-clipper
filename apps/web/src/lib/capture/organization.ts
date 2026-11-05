import { z } from 'zod'
import { tagRequestSchema } from './tags.js'
import { causalHeads, causalParentsSchema, hasSingleParent, articleTargets } from './causal.js'
import { lowercaseUuidSchema } from '../validation/values.js'
import type { Article, LibraryArticle } from '../contracts/articles.js'
export const articleStatuses = ['inbox', 'later', 'archive'] as const
export const libraryViews = ['all', ...articleStatuses, 'trash'] as const
export type ArticleStatus = (typeof articleStatuses)[number]
export function isArticleStatus(value: string): value is ArticleStatus {
	return articleStatuses.some((status) => status === value)
}
export type LibraryView = (typeof libraryViews)[number]
export const organizationRequestSchema = z.discriminatedUnion('field', [
	z.object({ id: lowercaseUuidSchema, field: z.literal('status'), value: z.enum(articleStatuses) }),
	z.object({ id: lowercaseUuidSchema, field: z.literal('favorite'), value: z.boolean() }),
	z.object({ id: lowercaseUuidSchema, field: z.literal('trashed'), value: z.boolean() }),
	tagRequestSchema
])
export type OrganizationRequest = z.infer<typeof organizationRequestSchema>
export const organizationOperationSchema = z
	.object({
		id: lowercaseUuidSchema,
		libraryId: lowercaseUuidSchema,
		articleId: lowercaseUuidSchema.nullable(),
		documentId: lowercaseUuidSchema.nullable(),
		field: z.enum(['status', 'favorite', 'trashed']),
		value: z.string().max(7),
		parents: causalParentsSchema
	})
	.refine((r) =>
		r.field === 'status'
			? articleStatuses.some((s) => s === r.value)
			: r.value === 'true' || r.value === 'false'
	)
	.refine(hasSingleParent)
	.transform(({ documentId, ...row }) => ({ ...row, articleId: row.articleId ?? documentId! }))
export type OrganizationOperation = z.infer<typeof organizationOperationSchema>
/** Causally superseded operations never win. Concurrent heads use operation UUID order,
 * independently for each scalar field. No clocks or toggle replay are involved. */
export const organizationHeads = causalHeads
export const organizationTargets = articleTargets
export function projectOrganization(
	rows: LibraryArticle[],
	operations: OrganizationOperation[],
	articles: Pick<Article, 'id' | 'contentId'>[] = []
) {
	return rows.map((row) => {
		const targets = organizationTargets(row.id, row.contentId, articles)
		const own = operations.filter((o) => targets.has(o.articleId))
		const status =
			organizationHeads(own.filter((o) => o.field === 'status')).at(-1)?.value ?? 'inbox'
		const favorite =
			organizationHeads(own.filter((o) => o.field === 'favorite')).at(-1)?.value === 'true'
		const trashed =
			organizationHeads(own.filter((operation) => operation.field === 'trashed')).at(-1)?.value ===
			'true'
		return { ...row, status: z.enum(articleStatuses).parse(status), favorite, trashed }
	})
}
export function matchesLibraryFilter(row: LibraryArticle, view: LibraryView, favorites: boolean) {
	return (
		(view === 'trash'
			? row.trashed === true
			: row.trashed !== true && (view === 'all' || (row.status ?? 'inbox') === view)) &&
		(!favorites || row.favorite === true)
	)
}
export function canOrganizeArticle(article: unknown, document: unknown) {
	return article != null || document != null
}

export function canRequestOrganization(rows: LibraryArticle[], request: OrganizationRequest) {
	if (!organizationRequestSchema.safeParse(request).success) return false
	return rows.some((row) => row.id === request.id)
}
