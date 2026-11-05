import { z } from 'zod'
import { caseFold } from 'unicode-case-folding'
import { lowercaseUuidSchema } from '../validation/values.js'
import { causalHeads, causalParentsSchema, hasSingleParent, articleTargets } from './causal.js'
import type { LibraryArticle, Article } from '../contracts/articles.js'
/** The package's pinned folding table is part of durable key version 1; do not upgrade it silently. */
export const tagNameSchema = z
	.string()
	.max(256)
	.refine((value) => !/[\uD800-\uDFFF]/u.test(value))
	.transform((value) => value.trim().normalize('NFC'))
	.refine((value) => Array.from(value).length >= 1 && Array.from(value).length <= 64)
export function isValidTagName(value: string) {
	return tagNameSchema.safeParse(value).success
}
export function tagKey(name: string) {
	return 'cf-1.1.2:' + caseFold(tagNameSchema.parse(name)).normalize('NFC')
}
export type Tag = { key: string; name: string }
export const tagRequestSchema = z.object({
	id: lowercaseUuidSchema,
	field: z.literal('tag'),
	value: tagNameSchema,
	assigned: z.boolean()
})
export const tagOperationSchema = z
	.object({
		id: lowercaseUuidSchema,
		libraryId: lowercaseUuidSchema,
		articleId: lowercaseUuidSchema.nullable(),
		documentId: lowercaseUuidSchema.nullable(),
		key: z.string().min(1).max(512),
		name: tagNameSchema,
		assigned: z.boolean(),
		parents: causalParentsSchema
	})
	.refine(hasSingleParent)
	.refine((row) => row.key === tagKey(row.name))
	.transform(({ documentId, ...row }) => ({
		...row,
		articleId: row.articleId ?? documentId!,
		field: 'tag' as const,
		value: row.name
	}))
export type TagOperation = z.infer<typeof tagOperationSchema>
export function projectTags(
	rows: LibraryArticle[],
	operations: TagOperation[],
	articles: Pick<Article, 'id' | 'contentId'>[] = []
): LibraryArticle[] {
	const vocabulary = new Map<string, Tag>()
	for (const operation of [...operations].sort((a, b) => a.id.localeCompare(b.id)))
		if (!vocabulary.has(operation.key))
			vocabulary.set(operation.key, { key: operation.key, name: operation.name })
	const tagVocabulary = [...vocabulary.values()].sort((a, b) => a.key.localeCompare(b.key))
	return rows.map((row) => {
		const targets = articleTargets(row.id, row.contentId, articles)
		const own = operations.filter((operation) => targets.has(operation.articleId))
		const tags = tagVocabulary.filter(
			(tag) =>
				causalHeads(own.filter((operation) => operation.key === tag.key)).at(-1)?.assigned === true
		)
		return { ...row, tags, tagVocabulary }
	})
}
export function matchesTags(row: LibraryArticle, keys: readonly string[]) {
	return keys.every((key) => row.tags?.some((tag) => tag.key === key))
}
