import { captureUuid, decodeCheckpoint, sameIntake } from './intake.js'
import type { IntakeCheckpoint, IntakeJournal } from '../contracts/intake.js'

export const INTAKE_DATABASE = 'clipper.capture-intake.1'
const storeName = 'checkpoints'
/** Each leaf owns and closes its connection; an issued write settles before returning. */
export function createIntakeJournal(
	libraryId: string,
	isCurrent: () => boolean,
	factory: IDBFactory = globalThis.indexedDB
): IntakeJournal {
	captureUuid(libraryId)
	function check() {
		if (!isCurrent()) throw new Error('Capture scope expired')
	}
	function open(): Promise<IDBDatabase> {
		check()
		return new Promise((resolve, reject) => {
			let failed = false
			const request = factory.open(INTAKE_DATABASE, 1)
			request.onupgradeneeded = () => request.result.createObjectStore(storeName)
			request.onblocked = () => {
				failed = true
				reject(new Error('Capture journal blocked'))
			}
			request.onerror = () => {
				failed = true
				reject(new Error('Capture journal unavailable'))
			}
			request.onsuccess = () => {
				const db = request.result
				db.onversionchange = () => db.close()
				if (failed) {
					db.close()
					return
				}
				resolve(db)
			}
		})
	}
	async function transaction<T>(
		mode: IDBTransactionMode,
		work: (
			store: IDBObjectStore,
			done: (value: T) => void,
			guard: (callback: () => void) => void
		) => void
	): Promise<T> {
		const db = await open()
		try {
			check()
			return await new Promise<T>((resolve, reject) => {
				const tx = db.transaction(storeName, mode, { durability: 'strict' })
				let output: { value: T } | undefined
				let failure: unknown
				tx.oncomplete = () => {
					try {
						check()
						if (!output) throw new Error('Missing journal result')
						resolve(output.value)
					} catch (error) {
						reject(error)
					}
				}
				tx.onabort = () => reject(failure ?? new Error('Capture journal transaction failed'))
				const store = tx.objectStore(storeName)
				// Request callbacks must remain synchronous to keep this native transaction alive.
				const guard = (callback: () => void) => {
					try {
						check()
						callback()
					} catch (error) {
						failure = error
						tx.abort()
					}
				}
				guard(() =>
					work(
						store,
						(value) => {
							output = { value }
						},
						guard
					)
				)
			})
		} finally {
			db.close()
		}
	}
	const key = (id: string): IDBValidKey => [libraryId, captureUuid(id)]
	return {
		get: (id) =>
			transaction<IntakeCheckpoint | null>('readonly', (store, done, guard) => {
				const request = store.get(key(id))
				request.onsuccess = () =>
					guard(() => {
						if (request.result === undefined) {
							done(null)
							return
						}
						const row = decodeCheckpoint(request.result, libraryId)
						if (row.intake.id !== id) throw new Error('Capture journal key mismatch')
						done(row)
					})
			}),
		create: (value) => {
			const row = decodeCheckpoint(value, libraryId)
			if (row.phase !== 'pending' || row.revision !== 0)
				throw new Error('Invalid initial checkpoint')
			return transaction<boolean>('readwrite', (store, done, guard) => {
				const request = store.get(key(row.intake.id))
				request.onsuccess = () =>
					guard(() => {
						if (request.result !== undefined) {
							decodeCheckpoint(request.result, libraryId)
							done(false)
							return
						}
						store.add(row, key(row.intake.id))
						done(true)
					})
			})
		},
		advance: (previous, phase) => {
			const expected = decodeCheckpoint(previous, libraryId)
			if (
				!(
					(expected.phase === 'pending' && phase === 'issuing') ||
					(expected.phase === 'issuing' && phase === 'admitted')
				)
			)
				throw new Error('Invalid checkpoint transition')
			return transaction<IntakeCheckpoint | null>('readwrite', (store, done, guard) => {
				const request = store.get(key(expected.intake.id))
				request.onsuccess = () =>
					guard(() => {
						if (request.result === undefined) {
							done(null)
							return
						}
						const current = decodeCheckpoint(request.result, libraryId)
						if (
							current.revision !== expected.revision ||
							current.phase !== expected.phase ||
							current.attemptId !== expected.attemptId ||
							!sameIntake(current.intake, expected.intake)
						) {
							done(null)
							return
						}
						const next = decodeCheckpoint(
							{ ...current, phase, revision: current.revision + 1 },
							libraryId
						)
						store.put(next, key(next.intake.id))
						done(next)
					})
			})
		},
		page: (after, limit = 100) => {
			if (!Number.isInteger(limit) || limit < 1 || limit > 100)
				throw new Error('Invalid journal page size')
			if (after !== undefined) captureUuid(after)
			return transaction<IntakeCheckpoint[]>('readonly', (store, done, guard) => {
				const rows: IntakeCheckpoint[] = []
				const range = IDBKeyRange.bound(
					[libraryId, after ?? ''],
					[libraryId, '\uffff'],
					after !== undefined
				)
				const request = store.openCursor(range)
				request.onsuccess = () =>
					guard(() => {
						check()
						const cursor = request.result
						if (!cursor) {
							done(rows)
							return
						}
						const row = decodeCheckpoint(cursor.value, libraryId)
						if (!Array.isArray(cursor.key) || cursor.key[1] !== row.intake.id)
							throw new Error('Capture journal key mismatch')
						rows.push(row)
						if (rows.length === limit) done(rows)
						else cursor.continue()
					})
			})
		}
	}
}
