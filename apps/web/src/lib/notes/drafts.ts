import { noteDraftRecordSchema, acknowledgesNoteDraft, sameNote } from './schema.js'
import type { NoteDraftRecord, NoteTarget } from './schema.js'
import { noteSchema } from './schema.js'
import type { Note } from './schema.js'
import { z } from 'zod'
import { lowercaseUuidSchema } from '../validation/values.js'
import { articleNoteDraftRecordSchema, acknowledgesArticleNoteDraft } from './legacy.js'
import type { ArticleNoteDraftRecord as LegacyDraftRecord } from './legacy.js'

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
function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('delightful-clipper-note-drafts-v1', 2)
		request.onupgradeneeded = () => {
			for (const name of ['drafts', 'noteDrafts']) {
				if (request.result.objectStoreNames.contains(name)) continue
				const store = request.result.createObjectStore(name, { keyPath: 'key' })
				store.createIndex('target', 'target')
			}
		}
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(new Error('Note draft storage unavailable'))
		request.onblocked = () => {
			request.onsuccess = () => request.result.close()
			reject(new Error('Note draft storage blocked'))
		}
	})
}

/** Authored recovery data, not a disposable cache. Deployment/account/parent and
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
	function entry(value: NoteDraftRecord) {
		const record = noteDraftRecordSchema.parse(value)
		return {
			key: JSON.stringify([namespace, libraryId, record.draft.noteId, record.writerId]),
			target: targetKey(record.draft),
			record
		}
	}
	async function transaction<T>(
		mode: IDBTransactionMode,
		operation: (store: IDBObjectStore, result: (value: T) => void) => void
	): Promise<T> {
		const db = await open()
		try {
			return await new Promise<T>((resolve, reject) => {
				const tx = db.transaction(['noteDrafts', 'drafts'], mode, { durability: 'strict' })
				let value: T
				tx.oncomplete = () => resolve(value)
				tx.onerror = () => reject(new Error('Note draft transaction failed'))
				tx.onabort = () => reject(new Error('Note draft transaction aborted'))
				try {
					operation(tx.objectStore('noteDrafts'), (result) => {
						value = result
					})
				} catch {
					tx.abort()
					reject(new Error('Invalid note draft data'))
				}
			})
		} finally {
			db.close()
		}
	}
	return {
		readLegacy: (articleId) =>
			transaction('readonly', (store, result) => {
				const request = store.transaction
					.objectStore('drafts')
					.index('target')
					.getAll(JSON.stringify([namespace, libraryId, articleId]))
				request.onsuccess = () => {
					try {
						const rows = request.result.map((row: { record: unknown }) =>
							articleNoteDraftRecordSchema.parse(row.record)
						)
						if (
							!rows.every(
								(row) => row.draft.libraryId === libraryId && row.draft.articleId === articleId
							)
						)
							throw new Error('Invalid legacy draft scope')
						result(rows)
					} catch {
						store.transaction.abort()
					}
				}
			}),
		recoverLegacy: (value, target, articleIds = []) =>
			transaction<void>('readwrite', (store) => {
				const source = articleNoteDraftRecordSchema.parse(value),
					note = noteSchema.parse(target)
				const aliases = new Set(z.array(lowercaseUuidSchema).max(4096).parse(articleIds))
				const associated = note.articleId ?? note.documentId
				const matchesAssociation =
					source.draft.articleId === associated ||
					(associated !== null && aliases.has(associated) && aliases.has(source.draft.articleId))
				if (
					source.draft.libraryId !== libraryId ||
					note.libraryId !== libraryId ||
					!matchesAssociation
				)
					throw new Error('Invalid draft recovery association')
				const { articleId, ...draft } = source.draft
				const converted = entry({ writerId: source.writerId, draft: { ...draft, noteId: note.id } })
				const sourceKey = JSON.stringify([namespace, libraryId, articleId, source.writerId])
				const legacyStore = store.transaction.objectStore('drafts')
				const request = legacyStore.get(sourceKey)
				request.onsuccess = () => {
					try {
						const current = articleNoteDraftRecordSchema.parse(request.result?.record)
						if (
							current.writerId !== source.writerId ||
							!acknowledgesArticleNoteDraft(current.draft, source.draft)
						) {
							store.transaction.abort()
							return
						}
					} catch {
						store.transaction.abort()
						return
					}
					const destination = store.get(converted.key)
					destination.onsuccess = () => {
						try {
							if (destination.result !== undefined) {
								const existing = noteDraftRecordSchema.parse(destination.result.record)
								if (
									existing.writerId !== converted.record.writerId ||
									!acknowledgesNoteDraft(existing.draft, converted.record.draft)
								) {
									store.transaction.abort()
									return
								}
							}
							store.put(converted)
							legacyStore.delete(sourceKey)
						} catch {
							store.transaction.abort()
						}
					}
				}
			}),
		read: (target) =>
			transaction('readonly', (store, result) => {
				const key = targetKey(target)
				const request = store.index('target').getAll(key)
				request.onsuccess = () => {
					try {
						const records = request.result.map((row: { record: unknown }) =>
							noteDraftRecordSchema.parse(row.record)
						)
						if (!records.every((record) => sameNote(record.draft, target)))
							throw new Error('Invalid scope')
						result(records)
					} catch {
						store.transaction.abort()
					}
				}
			}),
		write: (record) =>
			transaction<void>('readwrite', (store) => {
				store.put(entry(record))
			}),
		remove: (record) =>
			transaction<void>('readwrite', (store) => {
				const expected = entry(record)
				const request = store.get(expected.key)
				request.onsuccess = () => {
					if (request.result === undefined) return
					try {
						const current = noteDraftRecordSchema.parse(request.result.record)
						if (
							current.writerId === record.writerId &&
							acknowledgesNoteDraft(current.draft, record.draft)
						)
							store.delete(expected.key)
					} catch {
						store.transaction.abort()
					}
				}
			})
	}
}
