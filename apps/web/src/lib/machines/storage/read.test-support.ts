import { createActor, toPromise } from 'xstate'
import type { ReadCapabilities, ReadResult } from '../../contracts/storage.js'
import { readRecordMachine } from './read.js'
/** Test integration only: production invokes the read actor and receives its report. */
export async function readRecord(capability: ReadCapabilities, id: string): Promise<ReadResult> {
	const delivered: { value: ReadResult } = { value: { kind: 'unavailable' } }
	const actor = createActor(readRecordMachine, { input: { capability, id } })
	const subscription = actor.on('record', ({ result }) => {
		delivered.value = result
	})
	try {
		actor.start()
		await toPromise(actor)
		return delivered.value
	} finally {
		subscription.unsubscribe()
		actor.stop()
	}
}
