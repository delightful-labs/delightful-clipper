import { z } from 'zod'
import { lowercaseUuidSchema, utf8StringSchema } from '../validation/values.js'
import { causalHeads, causalParentsSchema, hasSingleParent } from '../capture/causal.js'

const NOTE_TEXT_LIMIT = 262144
export const noteTextSchema = z
	.string()
	.max(NOTE_TEXT_LIMIT)
	.pipe(utf8StringSchema(NOTE_TEXT_LIMIT))
const revisionIdsSchema = z
	.array(lowercaseUuidSchema)
	.max(4096)
	.refine((ids) => new Set(ids).size === ids.length)

/** Independent identity and an explicit article association. Highlight attachment
 * can extend this entity when highlight records are implemented. */
// Compose field subsets before applying the complete entity's parent invariant.
const noteFieldsSchema = z.object({
	id: lowercaseUuidSchema,
	libraryId: lowercaseUuidSchema,
	articleId: lowercaseUuidSchema.nullable(),
	documentId: lowercaseUuidSchema.nullable()
})
export const noteSchema = noteFieldsSchema.refine(hasSingleParent)
export type Note = z.infer<typeof noteSchema>
const noteIdentitySchema = noteFieldsSchema.pick({ id: true, libraryId: true })
export const noteCreateSchema = noteIdentitySchema.extend({
	articleId: noteFieldsSchema.shape.articleId.unwrap()
})
export type NoteCreate = z.infer<typeof noteCreateSchema>
export const noteRevisionSchema = noteIdentitySchema.extend({
	noteId: noteFieldsSchema.shape.id,
	text: noteTextSchema,
	parents: revisionIdsSchema,
	editedAt: z.iso.datetime()
})
export type NoteRevision = z.infer<typeof noteRevisionSchema>
export const noteTargetSchema = noteRevisionSchema.pick({ libraryId: true, noteId: true })
export type NoteTarget = z.infer<typeof noteTargetSchema>
export const storedNoteRevisionSchema = noteRevisionSchema.extend({
	parents: causalParentsSchema.pipe(noteRevisionSchema.shape.parents)
})
export const storedNoteHistorySchema = z.array(storedNoteRevisionSchema)
export const noteHistorySchema = z.array(noteSchema)
export const noteDraftSchema = noteRevisionSchema
	.pick({ libraryId: true, noteId: true, text: true })
	.extend({
		sequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
		baseRevisionIds: noteRevisionSchema.shape.parents
	})
export type NoteDraft = z.infer<typeof noteDraftSchema>
export const noteDraftRecordSchema = z.object({
	writerId: lowercaseUuidSchema,
	draft: noteDraftSchema
})
export type NoteDraftRecord = z.infer<typeof noteDraftRecordSchema>
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
