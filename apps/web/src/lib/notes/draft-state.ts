import type { NoteDraftRecord } from './schema.js'
import { noteDraftRecordSchema, sameNote } from './schema.js'

export type DraftHistory = {
	queue: readonly NoteDraftRecord[]
	issued: NoteDraftRecord | undefined
	durable: readonly NoteDraftRecord[]
}

export function sameDraftWriter(a: NoteDraftRecord, b: NoteDraftRecord) {
	return a.writerId === b.writerId && sameNote(a.draft, b.draft)
}
export function belongsToDraftLibrary(record: NoteDraftRecord, libraryId: string) {
	return record.draft.libraryId === libraryId
}
export function isNewerWriterDraft(next: NoteDraftRecord, previous: NoteDraftRecord) {
	return !sameDraftWriter(previous, next) || previous.draft.sequence < next.draft.sequence
}
export function isNewerThanDraftHistory(next: NoteDraftRecord, history: DraftHistory) {
	return (
		history.queue.every((previous) => isNewerWriterDraft(next, previous)) &&
		history.durable.every((previous) => isNewerWriterDraft(next, previous)) &&
		(!history.issued || isNewerWriterDraft(next, history.issued))
	)
}
export function canAdmitDraftEdit(input: unknown, libraryId: string, history: DraftHistory) {
	const parsed = noteDraftRecordSchema.safeParse(input)
	if (!parsed.success) return false
	if (!belongsToDraftLibrary(parsed.data, libraryId)) return false
	return isNewerThanDraftHistory(parsed.data, history)
}
export function replaceWriterDraft(records: readonly NoteDraftRecord[], next: NoteDraftRecord) {
	return [...records.filter((record) => !sameDraftWriter(record, next)), next]
}
export function hasQueuedWriterDraft(
	history: Pick<DraftHistory, 'queue'>,
	issued: NoteDraftRecord
) {
	return history.queue.some((record) => sameDraftWriter(record, issued))
}
export function retainFailedDraft(history: Pick<DraftHistory, 'queue' | 'issued'>) {
	if (!history.issued || hasQueuedWriterDraft(history, history.issued)) return [...history.queue]
	return [history.issued, ...history.queue]
}
