import { noteDraftRecordSchema } from './schema.js'
import type { Note, NoteDraftRecord, NoteTarget } from './schema.js'
import type { ArticleNoteDraftRecord as LegacyDraftRecord } from './legacy.js'
import { draftTransaction, readDraftRequest } from './draft-database.js'
import { runDraftMutation } from './draft-mutation-machine.js'
import type { DraftEntry } from './draft-mutation-machine.js'
import { readScopedDrafts, readScopedLegacyDrafts, prepareDraftRecovery } from './draft-recovery.js'

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
		recoverLegacy: async (value, target, articleIds = []) => {
			const recovery = prepareDraftRecovery(value, target, libraryId, articleIds)
			const sourceKey = JSON.stringify([
				namespace,
				libraryId,
				recovery.source.draft.articleId,
				recovery.source.writerId
			])
			await runDraftMutation({
				kind: 'recover',
				recovery,
				sourceKey,
				entry: entry(recovery.record)
			})
		},
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
		remove: async (record) => {
			await runDraftMutation({ kind: 'remove', entry: entry(record) })
		}
	}
}
