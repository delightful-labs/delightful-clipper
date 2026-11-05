import { z } from 'zod'
import { lowercaseUuidSchema } from '../validation/values.js'
export const causalParentsSchema = z
	.string()
	.max(262144)
	.transform((value, context): string[] => {
		try {
			return z.array(lowercaseUuidSchema).max(4096).parse(JSON.parse(value))
		} catch {
			context.addIssue({ code: 'custom', message: 'Invalid causal parents' })
			return z.NEVER
		}
	})
export function causalHeads<T extends { id: string; parents: string[] }>(rows: T[]) {
	const superseded = new Set(rows.flatMap((row) => row.parents))
	return rows.filter((row) => !superseded.has(row.id)).sort((a, b) => a.id.localeCompare(b.id))
}
export function hasSingleParent(row: { articleId: string | null; documentId: string | null }) {
	return (row.articleId === null) !== (row.documentId === null)
}
export function createArticleTargetLookup(
	articles: readonly { id: string; contentId: string | null }[]
) {
	const aliases = new Map<string, string[]>()
	for (const article of articles) {
		if (!article.contentId) continue
		const ids = aliases.get(article.contentId) ?? []
		ids.push(article.id)
		aliases.set(article.contentId, ids)
	}
	return (id: string, contentId: string | null) =>
		new Set(contentId ? [id, contentId, ...(aliases.get(contentId) ?? [])] : [id])
}
export type ArticleTargetLookup = ReturnType<typeof createArticleTargetLookup>
export function articleTargets(
	id: string,
	contentId: string | null,
	articles: readonly { id: string; contentId: string | null }[]
) {
	return createArticleTargetLookup(articles)(id, contentId)
}
/** Index once per observed snapshot; only histories for the row's native aliases are merged. */
export function indexCausalHistory<T extends { id: string; articleId: string; parents: string[] }>(
	rows: T[],
	property: (row: T) => string
) {
	const parents = new Map<string, Map<string, T[]>>()
	for (const row of rows) {
		const groups = parents.get(row.articleId) ?? new Map<string, T[]>()
		const key = property(row)
		const operations = groups.get(key) ?? []
		operations.push(row)
		groups.set(key, operations)
		parents.set(row.articleId, groups)
	}
	return (targets: ReadonlySet<string>) => {
		const groups = new Map<string, T[]>()
		for (const target of targets)
			for (const [key, operations] of parents.get(target) ?? []) {
				const merged = groups.get(key) ?? []
				for (const operation of operations) merged.push(operation)
				groups.set(key, merged)
			}
		const heads = new Map<string, T>()
		for (const [key, operations] of groups) {
			const head = causalHeads(operations).at(-1)
			if (head) heads.set(key, head)
		}
		return heads
	}
}
