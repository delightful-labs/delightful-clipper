import { z } from 'zod'
import { lowercaseUuidSchema, utf8StringSchema } from '../validation/values.js'
import { causalHeads, causalParentsSchema, hasSingleParent } from '../capture/causal.js'

export const noteTextSchema = z.string().max(262144).pipe(utf8StringSchema(262144))
const revisionIdsSchema = z
	.array(lowercaseUuidSchema)
	.max(4096)
	.refine((ids) => new Set(ids).size === ids.length)

/** Independent identity and an explicit article association. Highlight attachment
 * can extend this entity when highlight records are implemented. */
export const noteSchema = z
	.object({
		id: lowercaseUuidSchema,
		libraryId: lowercaseUuidSchema,
		articleId: lowercaseUuidSchema.nullable(),
		documentId: lowercaseUuidSchema.nullable()
	})
	.refine(hasSingleParent)
export type Note = z.infer<typeof noteSchema>
export const noteCreateSchema = z.object({
	id: lowercaseUuidSchema,
	libraryId: lowercaseUuidSchema,
	articleId: lowercaseUuidSchema
})
export type NoteCreate = z.infer<typeof noteCreateSchema>
export const noteRevisionSchema = z.object({
	id: lowercaseUuidSchema,
	libraryId: lowercaseUuidSchema,
	noteId: lowercaseUuidSchema,
	text: noteTextSchema,
	parents: revisionIdsSchema,
	editedAt: z.iso.datetime()
})
export type NoteRevision = z.infer<typeof noteRevisionSchema>
export const storedNoteRevisionSchema = noteRevisionSchema.extend({
	parents: causalParentsSchema.pipe(revisionIdsSchema)
})
export const storedNoteHistorySchema = z.array(storedNoteRevisionSchema)
export const noteHistorySchema = z.array(noteSchema)
export const noteDraftSchema = z.object({
	libraryId: lowercaseUuidSchema,
	noteId: lowercaseUuidSchema,
	sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
	text: noteTextSchema,
	baseRevisionIds: revisionIdsSchema
})
export type NoteDraft = z.infer<typeof noteDraftSchema>
export const noteDraftRecordSchema = z.object({
	writerId: lowercaseUuidSchema,
	draft: noteDraftSchema
})
export type NoteDraftRecord = z.infer<typeof noteDraftRecordSchema>
export type NoteTarget = Pick<NoteRevision, 'libraryId' | 'noteId'>
export function sameNote(a: NoteTarget, b: NoteTarget) {
	return a.libraryId === b.libraryId && a.noteId === b.noteId
}
export function sameNoteRevision(a: NoteRevision, b: NoteRevision) {
	return (
		sameNote(a, b) &&
		a.id === b.id &&
		a.text === b.text &&
		a.editedAt === b.editedAt &&
		a.parents.length === b.parents.length &&
		a.parents.every((id) => b.parents.includes(id))
	)
}
export function projectNote(target: NoteTarget, revisions: readonly NoteRevision[]) {
	const heads = causalHeads(revisions.filter((revision) => sameNote(target, revision)))
	const versions = new Map<string, NoteRevision[]>()
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
export function acknowledgesNoteDraft(draft: NoteDraft, acknowledgment: NoteDraft) {
	return (
		sameNote(draft, acknowledgment) &&
		draft.sequence === acknowledgment.sequence &&
		draft.text === acknowledgment.text &&
		draft.baseRevisionIds.length === acknowledgment.baseRevisionIds.length &&
		draft.baseRevisionIds.every((id) => acknowledgment.baseRevisionIds.includes(id))
	)
}
