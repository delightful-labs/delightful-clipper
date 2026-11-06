import { z } from 'zod'
import { lowercaseUuidSchema, utf8StringSchema } from '../validation/values.js'
import { causalHeads } from '../capture/causal.js'
import { causalParentsSchema } from '../capture/causal.js'

// A bounded plain-text payload; do not trim, normalize or interpret authored text.
export const noteTextSchema = z.string().max(262144).pipe(utf8StringSchema(262144))
const revisionIdsSchema = z
	.array(lowercaseUuidSchema)
	.max(4096)
	.refine((ids) => new Set(ids).size === ids.length)
export const articleNoteRevisionSchema = z.object({
	id: lowercaseUuidSchema,
	libraryId: lowercaseUuidSchema,
	articleId: lowercaseUuidSchema,
	text: noteTextSchema,
	parents: revisionIdsSchema,
	editedAt: z.iso.datetime()
})
export type ArticleNoteRevision = z.infer<typeof articleNoteRevisionSchema>
export const storedArticleNoteRevisionSchema = articleNoteRevisionSchema.extend({
	parents: causalParentsSchema.pipe(revisionIdsSchema)
})
export const storedArticleNoteHistorySchema = z.array(storedArticleNoteRevisionSchema)

// The parent tuple is the logical note identity. Two offline clients do not
// independently allocate editable note identities for the same article.
export const articleNoteDraftSchema = z.object({
	libraryId: lowercaseUuidSchema,
	articleId: lowercaseUuidSchema,
	sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
	text: noteTextSchema,
	baseRevisionIds: revisionIdsSchema
})
export type ArticleNoteDraft = z.infer<typeof articleNoteDraftSchema>
export const articleNoteDraftRecordSchema = z.object({
	writerId: lowercaseUuidSchema,
	draft: articleNoteDraftSchema
})
export type ArticleNoteDraftRecord = z.infer<typeof articleNoteDraftRecordSchema>
export type ArticleNoteTarget = Pick<ArticleNoteRevision, 'libraryId' | 'articleId'>

export function sameArticleNote(a: ArticleNoteTarget, b: ArticleNoteTarget) {
	return a.libraryId === b.libraryId && a.articleId === b.articleId
}

/** An operation ID alone cannot prove that an uncertain intended write was observed. */
export function sameArticleNoteRevision(a: ArticleNoteRevision, b: ArticleNoteRevision) {
	return (
		sameArticleNote(a, b) &&
		a.id === b.id &&
		a.text === b.text &&
		a.editedAt === b.editedAt &&
		a.parents.length === b.parents.length &&
		a.parents.every((id) => b.parents.includes(id))
	)
}

/** Keep every divergent head. Timestamps and UUID ordering never choose user text. */
export function projectArticleNote(
	target: ArticleNoteTarget,
	revisions: readonly ArticleNoteRevision[],
	aliases: ReadonlySet<string> = new Set([target.articleId])
) {
	const heads = causalHeads(
		revisions.filter(
			(revision) => revision.libraryId === target.libraryId && aliases.has(revision.articleId)
		)
	)
	const versions = new Map<string, ArticleNoteRevision[]>()
	for (const head of heads) {
		const identical = versions.get(head.text) ?? []
		identical.push(head)
		versions.set(head.text, identical)
	}
	return {
		heads,
		versions: [...versions].map(([text, revisions]) => ({ text, revisions })),
		conflicted: versions.size > 1
	}
}

/** A completion can acknowledge only the exact local edit it persisted. */
export function acknowledgesArticleNoteDraft(
	draft: ArticleNoteDraft,
	acknowledgment: ArticleNoteDraft
) {
	return (
		sameArticleNote(draft, acknowledgment) &&
		draft.sequence === acknowledgment.sequence &&
		draft.text === acknowledgment.text &&
		draft.baseRevisionIds.length === acknowledgment.baseRevisionIds.length &&
		draft.baseRevisionIds.every((id) => acknowledgment.baseRevisionIds.includes(id))
	)
}
