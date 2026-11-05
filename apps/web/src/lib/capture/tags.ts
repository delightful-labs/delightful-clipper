import { z } from 'zod'
import { caseFold } from 'unicode-case-folding'
import { lowercaseUuidSchema } from '../validation/values.js'
import {
	causalParentsSchema,
	hasSingleParent,
	createArticleTargetLookup,
	indexCausalHistory
} from './causal.js'
import type { ArticleTargetLookup } from './causal.js'
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
export function tagComparisonKey(name: string) {
	return caseFold(name.trim().normalize('NFC')).normalize('NFC')
}
export function tagKey(name: string) {
	return 'cf-1.1.2:' + tagComparisonKey(tagNameSchema.parse(name))
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
	articles: Pick<Article, 'id' | 'contentId'>[] = [],
	targets: ArticleTargetLookup = createArticleTargetLookup(articles)
): LibraryArticle[] {
	const vocabulary = new Map<string, Tag>()
	for (const operation of [...operations].sort((a, b) => a.id.localeCompare(b.id)))
		if (!vocabulary.has(operation.key))
			vocabulary.set(operation.key, { key: operation.key, name: operation.name })
	const tagVocabulary = [...vocabulary.values()].sort((a, b) => a.key.localeCompare(b.key))
	const tagOrder = new Map(tagVocabulary.map((tag, index) => [tag.key, index]))
	const history = indexCausalHistory(operations, (operation) => operation.key)
	return rows.map((row) => {
		const heads = history(targets(row.id, row.contentId))
		const tags = [...heads]
			.flatMap(([key, head]) => {
				const tag = vocabulary.get(key)
				return head.assigned && tag ? [tag] : []
			})
			.sort((a, b) => tagOrder.get(a.key)! - tagOrder.get(b.key)!)
		return { ...row, tags, tagVocabulary }
	})
}
export function matchesTags(row: LibraryArticle, keys: readonly string[]) {
	return keys.every((key) => row.tags?.some((tag) => tag.key === key))
}

export type TagSelectionChange =
	| { kind: 'invalid' | 'unchanged' }
	| { kind: 'changed'; name: string; assigned: boolean }
const tagSelectionSchema = z.array(tagNameSchema).max(4096)
/** DUI emits a complete selection; native membership changes remain one desired-value operation. */
export function tagSelectionChange(previous: readonly Tag[], names: unknown): TagSelectionChange {
	const parsed = tagSelectionSchema.safeParse(names)
	if (!parsed.success) return { kind: 'invalid' }
	const before = new Map(previous.map((tag) => [tag.key, tag.name]))
	const after = new Map(parsed.data.map((name) => [tagKey(name), name]))
	const added = [...after].filter(([key]) => !before.has(key))
	const removed = [...before].filter(([key]) => !after.has(key))
	if (!added.length && !removed.length) return { kind: 'unchanged' }
	if (added.length + removed.length !== 1) return { kind: 'invalid' }
	const item = added[0] ?? removed[0]
	if (!item) return { kind: 'invalid' }
	return { kind: 'changed', name: item[1], assigned: added.length === 1 }
}
