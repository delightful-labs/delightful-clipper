import type { Note, NoteRevision } from './schema.js'
import { sameNoteRevision } from './schema.js'
import type { ArticleNoteRevision as LegacyRevision } from './legacy.js'

export type NoteAssociation = {
	library: unknown
	parent: unknown
	targets: ReadonlySet<string>
	notes: readonly Note[]
}
export type NoteRevisionRows = { note: Note | null; history: readonly NoteRevision[] }
export type LegacyNoteImportRows = NoteAssociation &
	NoteRevisionRows & {
		source: readonly LegacyRevision[]
		expected: readonly NoteRevision[]
		missing: readonly NoteRevision[]
	}

export function belongsToArticle(note: Note, targets: ReadonlySet<string>) {
	return targets.has(note.articleId ?? note.documentId ?? '')
}
export function hasNoteParent(rows: NoteAssociation) {
	return !!rows.library && !!rows.parent
}
export function hasNoteForArticle(rows: NoteAssociation) {
	return rows.notes.some((note) => belongsToArticle(note, rows.targets))
}
export function hasUnusedNoteId(notes: readonly Note[], id: string) {
	return !notes.some((note) => note.id === id)
}
export function hasUnusedRevisionId(knownIds: ReadonlySet<string>, id: string) {
	return !knownIds.has(id)
}
export function matchesNoteOperation(
	record: Pick<Note, 'id' | 'libraryId'>,
	libraryId: string,
	operationId: string
) {
	return record.libraryId === libraryId && record.id === operationId
}
export function hasKnownRevisionParents(revision: NoteRevision, knownIds: ReadonlySet<string>) {
	return revision.parents.every((id) => knownIds.has(id))
}
function revisionIdsForNote(history: readonly NoteRevision[], noteId: string) {
	return history.filter((revision) => revision.noteId === noteId).map((revision) => revision.id)
}
export function canCreateNote(rows: NoteAssociation, noteId: string) {
	return hasNoteParent(rows) && !hasNoteForArticle(rows) && hasUnusedNoteId(rows.notes, noteId)
}
export function canWriteNoteRevision(rows: NoteRevisionRows, revision: NoteRevision) {
	if (!rows.note) return false
	if (!hasUnusedRevisionId(new Set(rows.history.map((row) => row.id)), revision.id)) return false
	return hasKnownRevisionParents(
		revision,
		new Set(revisionIdsForNote(rows.history, revision.noteId))
	)
}
export function hasLegacyImportWork(rows: LegacyNoteImportRows) {
	return rows.source.length > 0 && rows.missing.length > 0
}
export function hasCompatibleImportAssociation(rows: LegacyNoteImportRows) {
	return rows.note ? belongsToArticle(rows.note, rows.targets) : !hasNoteForArticle(rows)
}
export function hasCompatibleRevisionIds(
	expected: readonly NoteRevision[],
	history: readonly NoteRevision[]
) {
	const known = new Map(history.map((revision) => [revision.id, revision]))
	return expected.every((revision) => {
		const existing = known.get(revision.id)
		return !existing || sameNoteRevision(existing, revision)
	})
}
export function hasKnownImportParents(rows: LegacyNoteImportRows) {
	const noteId = rows.expected[0]?.noteId
	const knownIds = new Set([
		...rows.expected.map((revision) => revision.id),
		...revisionIdsForNote(rows.history, noteId ?? '')
	])
	return rows.expected.every((revision) => hasKnownRevisionParents(revision, knownIds))
}
export function canImportLegacy(rows: LegacyNoteImportRows) {
	if (!hasNoteParent(rows)) return false
	if (!hasLegacyImportWork(rows)) return false
	if (!hasCompatibleImportAssociation(rows)) return false
	if (!hasCompatibleRevisionIds(rows.expected, rows.history)) return false
	return hasKnownImportParents(rows)
}
