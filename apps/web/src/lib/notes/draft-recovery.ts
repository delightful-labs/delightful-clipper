import { z } from 'zod'
import { lowercaseUuidSchema } from '../validation/values.js'
import { noteSchema, noteDraftRecordSchema, acknowledgesNoteDraft, sameNote } from './schema.js'
import type { Note, NoteDraftRecord, NoteTarget } from './schema.js'
import { articleNoteDraftRecordSchema, acknowledgesArticleNoteDraft } from './legacy.js'
import type { ArticleNoteDraftRecord as LegacyDraftRecord } from './legacy.js'

const storedDraftSchema = z.object({ record: noteDraftRecordSchema })
const storedLegacyDraftSchema = z.object({ record: articleNoteDraftRecordSchema })
const recoveryAliasesSchema = z.array(lowercaseUuidSchema).max(4096)

export function matchesDraftRecord(current: NoteDraftRecord, expected: NoteDraftRecord) {
	return (
		current.writerId === expected.writerId && acknowledgesNoteDraft(current.draft, expected.draft)
	)
}
export function matchesLegacyDraftRecord(current: LegacyDraftRecord, expected: LegacyDraftRecord) {
	return (
		current.writerId === expected.writerId &&
		acknowledgesArticleNoteDraft(current.draft, expected.draft)
	)
}
export function readScopedDrafts(value: unknown, target: NoteTarget) {
	const records = z
		.array(storedDraftSchema)
		.parse(value)
		.map((row) => row.record)
	if (!records.every((record) => sameNote(record.draft, target)))
		throw new Error('Invalid note draft scope')
	return records
}
export function readScopedLegacyDrafts(value: unknown, libraryId: string, articleId: string) {
	const records = z
		.array(storedLegacyDraftSchema)
		.parse(value)
		.map((row) => row.record)
	if (!records.every((record) => belongsToLegacyArticle(record, libraryId, articleId)))
		throw new Error('Invalid legacy draft scope')
	return records
}
export function belongsToLegacyArticle(
	record: LegacyDraftRecord,
	libraryId: string,
	articleId: string
) {
	return record.draft.libraryId === libraryId && record.draft.articleId === articleId
}
export function matchesRecoveryArticle(
	source: LegacyDraftRecord,
	note: Note,
	aliases: ReadonlySet<string>
) {
	const associated = note.articleId ?? note.documentId
	return (
		source.draft.articleId === associated ||
		(associated !== null && aliases.has(associated) && aliases.has(source.draft.articleId))
	)
}
export function canRecoverDraft(
	source: LegacyDraftRecord,
	note: Note,
	libraryId: string,
	aliases: ReadonlySet<string>
) {
	return (
		source.draft.libraryId === libraryId &&
		note.libraryId === libraryId &&
		matchesRecoveryArticle(source, note, aliases)
	)
}
export function prepareDraftRecovery(
	value: unknown,
	target: unknown,
	libraryId: string,
	articleIds: readonly string[]
) {
	const source = articleNoteDraftRecordSchema.parse(value)
	const note = noteSchema.parse(target)
	const aliases = new Set(recoveryAliasesSchema.parse(articleIds))
	const { articleId: _articleId, ...draft } = source.draft
	return {
		source,
		note,
		aliases,
		libraryId,
		record: { writerId: source.writerId, draft: { ...draft, noteId: note.id } }
	}
}
export function isStoredDraft(value: unknown) {
	return storedDraftSchema.safeParse(value).success
}
export function matchesStoredDraft(value: unknown, expected: NoteDraftRecord) {
	const parsed = storedDraftSchema.safeParse(value)
	return parsed.success && matchesDraftRecord(parsed.data.record, expected)
}
export function matchesStoredLegacyDraft(value: unknown, expected: LegacyDraftRecord) {
	const parsed = storedLegacyDraftSchema.safeParse(value)
	return parsed.success && matchesLegacyDraftRecord(parsed.data.record, expected)
}
export function canReplaceRecoveredDraft(value: unknown, expected: NoteDraftRecord) {
	return value === undefined || matchesStoredDraft(value, expected)
}
