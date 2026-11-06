import {
	articleNoteDraftRecordSchema,
	acknowledgesArticleNoteDraft,
	sameArticleNote
} from './schema.js'
import type { ArticleNoteDraftRecord, ArticleNoteTarget } from './schema.js'

export type NoteDraftStore = {
	read: (target: ArticleNoteTarget) => Promise<ArticleNoteDraftRecord[]>
	write: (record: ArticleNoteDraftRecord) => Promise<void>
	remove: (record: ArticleNoteDraftRecord) => Promise<void>
}
function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open('delightful-clipper-note-drafts-v1', 1)
		request.onupgradeneeded = () => {
			const store = request.result.createObjectStore('drafts', { keyPath: 'key' })
			store.createIndex('target', 'target')
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
export function createNoteDraftStore(namespace: string, libraryId: string): NoteDraftStore {
	function targetKey(target: ArticleNoteTarget) {
		if (target.libraryId !== libraryId) throw new Error('Invalid note draft scope')
		return JSON.stringify([namespace, libraryId, target.articleId])
	}
	function entry(value: ArticleNoteDraftRecord) {
		const record = articleNoteDraftRecordSchema.parse(value)
		return {
			key: JSON.stringify([namespace, libraryId, record.draft.articleId, record.writerId]),
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
				const tx = db.transaction('drafts', mode, { durability: 'strict' })
				let value: T
				tx.oncomplete = () => resolve(value)
				tx.onerror = () => reject(new Error('Note draft transaction failed'))
				tx.onabort = () => reject(new Error('Note draft transaction aborted'))
				try {
					operation(tx.objectStore('drafts'), (result) => {
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
		read: (target) =>
			transaction('readonly', (store, result) => {
				const key = targetKey(target)
				const request = store.index('target').getAll(key)
				request.onsuccess = () => {
					try {
						const records = request.result.map((row: { record: unknown }) =>
							articleNoteDraftRecordSchema.parse(row.record)
						)
						if (!records.every((record) => sameArticleNote(record.draft, target)))
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
						const current = articleNoteDraftRecordSchema.parse(request.result.record)
						if (
							current.writerId === record.writerId &&
							acknowledgesArticleNoteDraft(current.draft, record.draft)
						)
							store.delete(expected.key)
					} catch {
						store.transaction.abort()
					}
				}
			})
	}
}
