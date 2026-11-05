import { z } from 'zod'
export const cachedIndexSchema = z.object({ fingerprint: z.string().length(64), index: z.string() })
export type CachedIndex = z.infer<typeof cachedIndexSchema>
const database = 'delightful-clipper-search-v1'
function open(): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(database, 1)
		request.onupgradeneeded = () => request.result.createObjectStore('indexes')
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(new Error('Search cache unavailable'))
		request.onblocked = () => reject(new Error('Search cache blocked'))
	})
}
/** Disposable derived data only. The owning machine decides cache miss/corruption recovery. */
export async function readSearchCache(key: string): Promise<CachedIndex | undefined> {
	const db = await open()
	try {
		return await new Promise((resolve, reject) => {
			const tx = db.transaction('indexes', 'readonly'),
				request = tx.objectStore('indexes').get(key)
			request.onsuccess = () => {
				try {
					resolve(
						request.result === undefined ? undefined : cachedIndexSchema.parse(request.result)
					)
				} catch {
					reject(new Error('Invalid search cache'))
				}
			}
			request.onerror = () => reject(new Error('Search cache read failed'))
			tx.onabort = () => reject(new Error('Search cache read aborted'))
		})
	} finally {
		db.close()
	}
}
export async function writeSearchCache(key: string, value: CachedIndex): Promise<void> {
	const db = await open()
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('indexes', 'readwrite')
			tx.objectStore('indexes').put(value, key)
			tx.oncomplete = () => resolve()
			tx.onerror = () => reject(new Error('Search cache write failed'))
			tx.onabort = () => reject(new Error('Search cache write aborted'))
		})
	} finally {
		db.close()
	}
}
