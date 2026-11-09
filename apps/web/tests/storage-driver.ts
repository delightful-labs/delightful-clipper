import { readRecord } from '../src/lib/machines/storage/read.test-support.js'
import { createActor, toPromise } from 'xstate'
import { currentLibraryRecords } from './fixture-records.js'
export async function save(operationId: string) {
	const records = currentLibraryRecords()
	const result = await toPromise(
		createActor(records.saveMachine, {
			input: {
				operationId,
				title: 'Restart proof',
				text: 'Exact offline text café 🦊',
				bytes: Uint8Array.from({ length: 600 * 1024 }, (_, index) => index % 256),
				mediaType: 'application/octet-stream'
			}
		}).start()
	)
	return result.kind
}
export async function read(id: string) {
	const result = await readRecord(currentLibraryRecords().readCapabilities, id)
	if (result.kind !== 'available') return null
	return {
		text: result.text,
		byteLength: result.asset.kind === 'available' ? result.asset.bytes.byteLength : null,
		bytesHash:
			result.asset.kind === 'available'
				? Array.from(
						new Uint8Array(
							await crypto.subtle.digest('SHA-256', new Uint8Array(result.asset.bytes))
						),
						(byte) => byte.toString(16).padStart(2, '0')
					).join('')
				: null
	}
}
export { requestCapture } from './fixture-records.js'
