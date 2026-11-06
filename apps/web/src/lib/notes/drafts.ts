import { noteDraftRecordSchema } from './schema.js'
import type { Note, NoteDraftRecord, NoteTarget } from './schema.js'
import type { ArticleNoteDraftRecord as LegacyDraftRecord } from './legacy.js'
import { draftTransaction, readDraftRequest } from './draft-database.js'
import type { DraftStores } from './draft-database.js'
import {
	parseStoredDraft,
	parseStoredLegacyDraft,
	matchesDraftRecord,
	matchesLegacyDraftRecord,
	readScopedDrafts,
	readScopedLegacyDrafts,
	prepareDraftRecovery,
	canReplaceRecoveredDraft
} from './draft-recovery.js'

export type NoteDraftStore = {
	read: (target: NoteTarget) => Promise<NoteDraftRecord[]>
	write: (record: NoteDraftRecord) => Promise<void>
	remove: (record: NoteDraftRecord) => Promise<void>
}
type NoteDraftRecovery = {
	readLegacy: (articleId: string) => Promise<LegacyDraftRecord[]>
	/** Aliases must come from the bound native note repository's recoveryTarget read. */
	recoverLegacy: (
		record: LegacyDraftRecord,
		note: Note,
		articleIds?: readonly string[]
	) => Promise<void>
}
type DraftEntry = { key: string; target: string; record: NoteDraftRecord }

function moveRecoveredDraft(stores: DraftStores, sourceKey: string, converted: DraftEntry) {
	readDraftRequest(stores.notes.get(converted.key), stores.notes, (destination) => {
		if (!canReplaceRecoveredDraft(destination, converted.record))
			throw new Error('Conflicting recovered draft')
		stores.notes.put(converted)
		stores.legacy.delete(sourceKey)
	})
}
function recoverDraft(
	stores: DraftStores,
	sourceKey: string,
	source: LegacyDraftRecord,
	converted: DraftEntry
) {
	readDraftRequest(stores.legacy.get(sourceKey), stores.legacy, (value) => {
		if (!matchesLegacyDraftRecord(parseStoredLegacyDraft(value), source))
			throw new Error('Legacy draft changed')
		moveRecoveredDraft(stores, sourceKey, converted)
	})
}

/** Authored recovery data, not a disposable cache. Deployment/account/note and
 * per-editor keys prevent another tab or account from overwriting a draft.
 * Resolve writes only from transaction completion, never request success. */
export function createNoteDraftStore(
	namespace: string,
	libraryId: string
): NoteDraftStore & NoteDraftRecovery {
	function targetKey(target: NoteTarget) {
		if (target.libraryId !== libraryId) throw new Error('Invalid note draft scope')
		return JSON.stringify([namespace, libraryId, target.noteId])
	}
	function entry(value: NoteDraftRecord): DraftEntry {
		const record = noteDraftRecordSchema.parse(value)
		return {
			key: JSON.stringify([namespace, libraryId, record.draft.noteId, record.writerId]),
			target: targetKey(record.draft),
			record
		}
	}
	return {
		readLegacy: (articleId) =>
			draftTransaction('readonly', ({ legacy }, result) => {
				const key = JSON.stringify([namespace, libraryId, articleId])
				readDraftRequest(legacy.index('target').getAll(key), legacy, (value) =>
					result(readScopedLegacyDrafts(value, libraryId, articleId))
				)
			}),
		recoverLegacy: (value, target, articleIds = []) =>
			draftTransaction<void>('readwrite', (stores) => {
				const recovery = prepareDraftRecovery(value, target, libraryId, articleIds)
				const sourceKey = JSON.stringify([
					namespace,
					libraryId,
					recovery.source.draft.articleId,
					recovery.source.writerId
				])
				recoverDraft(stores, sourceKey, recovery.source, entry(recovery.record))
			}),
		read: (target) =>
			draftTransaction('readonly', ({ notes }, result) => {
				readDraftRequest(notes.index('target').getAll(targetKey(target)), notes, (value) =>
					result(readScopedDrafts(value, target))
				)
			}),
		write: (record) =>
			draftTransaction<void>('readwrite', ({ notes }) => {
				notes.put(entry(record))
			}),
		remove: (record) =>
			draftTransaction<void>('readwrite', ({ notes }) => {
				const expected = entry(record)
				readDraftRequest(notes.get(expected.key), notes, (value) => {
					if (value === undefined) return
					if (matchesDraftRecord(parseStoredDraft(value), expected.record))
						notes.delete(expected.key)
				})
			})
	}
}
