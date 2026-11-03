import { createActor, toPromise } from 'xstate'
import { currentLibraryRecords } from '../src/lib/backend/jazz/account.js'
export async function save(operationId: string) {
	const records = currentLibraryRecords()
	const result = await toPromise(
		createActor(records.saveMachine, {
			input: {
				operationId,
				title: 'Restart proof',
				text: 'Exact offline text café 🦊',
				bytes: new Uint8Array([0, 1, 2, 255]),
				mediaType: 'application/octet-stream'
			}
		}).start()
	)
	return result.kind
}
export async function read(id: string) {
	const result = await toPromise(
		createActor(currentLibraryRecords().readMachine, { input: { id } }).start()
	)
	if (result.kind !== 'available') return null
	return {
		text: result.text,
		bytes: result.asset.kind === 'available' ? Array.from(result.asset.bytes) : null
	}
}
export { requestCapture } from '../src/lib/backend/jazz/account.js'
