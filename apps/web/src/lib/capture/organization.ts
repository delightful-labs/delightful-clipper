import { z } from 'zod'
import { lowercaseUuidSchema } from '../validation/values.js'
import type { Article, LibraryArticle } from '../contracts/articles.js'
export const articleStatuses = ['inbox', 'later', 'archive'] as const
export const libraryViews = ['all', ...articleStatuses] as const
export type ArticleStatus = (typeof articleStatuses)[number]
export function isArticleStatus(value: string): value is ArticleStatus {
	return articleStatuses.some((status) => status === value)
}
export type LibraryView = (typeof libraryViews)[number]
export const organizationRequestSchema = z.discriminatedUnion('field', [
	z.object({ id: lowercaseUuidSchema, field: z.literal('status'), value: z.enum(articleStatuses) }),
	z.object({ id: lowercaseUuidSchema, field: z.literal('favorite'), value: z.boolean() })
])
export type OrganizationRequest = z.infer<typeof organizationRequestSchema>
export const organizationOperationSchema = z
	.object({
		id: lowercaseUuidSchema,
		libraryId: lowercaseUuidSchema,
		articleId: lowercaseUuidSchema,
		field: z.enum(['status', 'favorite']),
		value: z.string().max(7),
		parents: z
			.string()
			.max(262144)
			.transform((s, ctx): string[] => {
				try {
					return z.array(lowercaseUuidSchema).max(4096).parse(JSON.parse(s))
				} catch {
					ctx.addIssue({ code: 'custom', message: 'Invalid operation parents' })
					return z.NEVER
				}
			})
	})
	.refine((r) =>
		r.field === 'status'
			? articleStatuses.some((s) => s === r.value)
			: r.value === 'true' || r.value === 'false'
	)
export type OrganizationOperation = z.infer<typeof organizationOperationSchema>
/** Causally superseded operations never win. Concurrent heads use operation UUID order,
 * independently for each scalar field. No clocks or toggle replay are involved. */
export function organizationHeads(rows: OrganizationOperation[]) {
	const superseded = new Set(rows.flatMap((r) => r.parents))
	return rows.filter((r) => !superseded.has(r.id)).sort((a, b) => a.id.localeCompare(b.id))
}
export function organizationTargets(
	id: string,
	contentId: string | null,
	articles: Pick<Article, 'id' | 'contentId'>[]
) {
	const targets = new Set([id])
	if (!contentId) return targets
	targets.add(contentId)
	for (const article of articles) if (article.contentId === contentId) targets.add(article.id)
	return targets
}
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
		return { ...row, status: z.enum(articleStatuses).parse(status), favorite }
	})
}
export function matchesLibraryFilter(row: LibraryArticle, view: LibraryView, favorites: boolean) {
	return (
		(view === 'all' || (row.status ?? 'inbox') === view) && (!favorites || row.favorite === true)
	)
}
export function canOrganizeArticle(article: unknown, document: unknown) {
	return article != null || document != null
}

export function canRequestOrganization(rows: LibraryArticle[], request: OrganizationRequest) {
	if (!organizationRequestSchema.safeParse(request).success) return false
	return rows.some((row) => row.id === request.id)
}
