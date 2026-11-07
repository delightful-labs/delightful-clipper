import { createActor, toPromise } from 'xstate'
import { currentLibraryRecords } from '../src/lib/backend/jazz/account.js'

/** Disposable browser fixture through the actual domain save owner, never raw storage. */
export async function seedStartupLibrary(count: number) {
	const records = currentLibraryRecords()
	const ids = Array.from({ length: count }, () => crypto.randomUUID())
	const save = (operationId: string, index: number) => {
		const text = `Startup body ${index}. ${'Saved reading context. '.repeat(500)} ${index === 0 ? 'uniquestartupneedle' : ''}`
		return toPromise(
			createActor(records.saveMachine, {
				input: {
					operationId,
					title: `Startup article ${String(index).padStart(3, '0')}`,
					text,
					bytes: new TextEncoder().encode(text),
					mediaType: 'text/plain'
				}
			}).start()
		)
	}
	const [first, ...rest] = ids
	if (!first) return ids
	// Persist the searchable fixture first so it is older than every other row
	// and definitely outside the first rendered batch after a restart.
	const initial = await save(first, 0)
	const results = [initial, ...(await Promise.all(rest.map((id, index) => save(id, index + 1))))]

	if (results.some((result) => result.kind !== 'saved')) throw new Error('Startup fixture failed')
	return ids
}
