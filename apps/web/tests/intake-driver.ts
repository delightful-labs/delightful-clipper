import { createActor, toPromise } from 'xstate'
import { currentLibraryRecords } from '../src/lib/backend/jazz/account.js'
import { prepareIntake } from '../src/lib/capture/intake.js'
import { createAdmissionMachine } from '../src/lib/machines/capture/admission.js'

export async function admit(id: string, waitForSync = true) {
	const records = currentLibraryRecords()
	const intake = prepareIntake(
		records.intakes.libraryId,
		id,
		'https://example.com/article?b=2&a=1#note',
		new Date().toISOString()
	)
	const result = await toPromise(
		createActor(createAdmissionMachine({ ...records.intakes, isCurrent: records.isCurrent }), {
			input: { kind: 'new', intake }
		}).start()
	)
	if (result.kind === 'admitted' && waitForSync)
		await Promise.all(result.receipts.map((receipt) => receipt.global()))
	return result.kind
}
export async function recover(id: string) {
	const records = currentLibraryRecords()
	const result = await toPromise(
		createActor(createAdmissionMachine({ ...records.intakes, isCurrent: records.isCurrent }), {
			input: { kind: 'recover', intakeId: id }
		}).start()
	)
	return {
		kind: result.kind,
		url: result.kind === 'recovered' ? result.intake.submittedUrl : null,
		hasReceipts: 'receipts' in result
	}
}
export async function read(id: string) {
	return (await currentLibraryRecords().intakes.read(id))?.submittedUrl ?? null
}
