export type DraftStores = { notes: IDBObjectStore; legacy: IDBObjectStore }

export function openDraftDatabase(): Promise<IDBDatabase> {
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

export async function draftTransaction<T>(
	mode: IDBTransactionMode,
	operation: (stores: DraftStores, result: (value: T) => void) => void
): Promise<T> {
	const db = await openDraftDatabase()
	try {
		return await new Promise<T>((resolve, reject) => {
			const tx = db.transaction(['noteDrafts', 'drafts'], mode, { durability: 'strict' })
			let value: T
			tx.oncomplete = () => resolve(value)
			tx.onerror = () => reject(new Error('Note draft transaction failed'))
			tx.onabort = () => reject(new Error('Note draft transaction aborted'))
			try {
				operation(
					{ notes: tx.objectStore('noteDrafts'), legacy: tx.objectStore('drafts') },
					(result) => {
						value = result
					}
				)
			} catch {
				tx.abort()
				reject(new Error('Invalid note draft data'))
			}
		})
	} finally {
		db.close()
	}
}

/** Keep dependent reads/writes in the active IndexedDB transaction. A callback
 * failure aborts the whole operation; only transaction completion acknowledges it. */
export function readDraftRequest<T>(
	request: IDBRequest<T>,
	store: IDBObjectStore,
	consume: (value: T) => void
) {
	request.onsuccess = () => {
		try {
			consume(request.result)
		} catch {
			store.transaction.abort()
		}
	}
}
