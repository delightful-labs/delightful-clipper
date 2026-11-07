import { z } from 'zod'
import { tagRequestSchema } from './tags.js'
import {
	causalHeads,
	causalParentsSchema,
	hasSingleParent,
	articleTargets,
	createArticleTargetLookup,
	indexCausalHistory
} from './causal.js'
import type { ArticleTargetLookup } from './causal.js'
import { lowercaseUuidSchema } from '../validation/values.js'
import type { Article, LibraryArticle } from '../contracts/articles.js'
export const articleStatuses = ['inbox', 'later', 'archive'] as const
export const libraryViews = ['all', ...articleStatuses, 'trash'] as const
export type ArticleStatus = (typeof articleStatuses)[number]
export function isArticleStatus(value: string): value is ArticleStatus {
	return articleStatuses.some((status) => status === value)
}
export type LibraryView = (typeof libraryViews)[number]
const organizationTargetSchema = tagRequestSchema.pick({ id: true })
const articleStatusSchema = z.enum(articleStatuses)
export const organizationRequestSchema = z.discriminatedUnion('field', [
	organizationTargetSchema.extend({ field: z.literal('status'), value: articleStatusSchema }),
	organizationTargetSchema.extend({ field: z.literal('favorite'), value: z.boolean() }),
	organizationTargetSchema.extend({ field: z.literal('trashed'), value: z.boolean() }),
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
	articles: Pick<Article, 'id' | 'contentId'>[] = [],
	targets: ArticleTargetLookup = createArticleTargetLookup(articles)
) {
	const history = indexCausalHistory(operations, (operation) => operation.field)
	return rows.map((row) => {
		const heads = history(targets(row.id, row.contentId))
		return {
			...row,
			status: articleStatusSchema.parse(heads.get('status')?.value ?? 'inbox'),
			favorite: heads.get('favorite')?.value === 'true',
			trashed: heads.get('trashed')?.value === 'true'
		}
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
