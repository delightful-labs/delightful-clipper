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
export function articleTargets(
	id: string,
	contentId: string | null,
	articles: readonly { id: string; contentId: string | null }[]
) {
	const targets = new Set([id])
	if (!contentId) return targets
	targets.add(contentId)
	for (const article of articles) if (article.contentId === contentId) targets.add(article.id)
	return targets
}
