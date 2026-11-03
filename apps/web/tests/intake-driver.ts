import { createActor, toPromise } from 'xstate'
import { currentLibraryRecords } from '../src/lib/backend/jazz/account.js'
import { createIntakeJournal, INTAKE_DATABASE } from '../src/lib/capture/intake-journal.js'
import { prepareIntake } from '../src/lib/capture/intake.js'
import { createAdmissionMachine } from '../src/lib/machines/capture/admission.js'
import type { IntakeCheckpoint } from '../src/lib/contracts/intake.js'

function binding() {
	const records = currentLibraryRecords()
	const native = records.intakes
	const journal = createIntakeJournal(native.libraryId, records.isCurrent)
	return { journal, records, native }
}
export async function admit(id: string, waitForSync = true) {
	const { native, journal, records } = binding()
	const old = await journal.get(id)
	const intake =
		old?.intake ??
		prepareIntake(
			native.libraryId,
			id,
			'https://example.com/article?b=2&a=1#note',
			new Date().toISOString()
		)
	const actor = createActor(
		createAdmissionMachine({ ...native, journal, isCurrent: records.isCurrent }),
		{
			input: { intake, attemptId: old?.attemptId ?? crypto.randomUUID() }
		}
	).start()
	const result = await toPromise(actor)
	if (result.kind === 'admitted' && waitForSync)
		await Promise.all(result.receipts.map((receipt) => receipt.global()))
	return result.kind
}
export async function read(id: string) {
	const { native, journal } = binding()
	const checkpoint = await journal.get(id)
	const row = await native.read(id)
	return {
		phase: checkpoint?.phase ?? null,
		url: checkpoint?.intake.submittedUrl ?? null,
		nativeUrl: row?.submittedUrl ?? null
	}
}
export async function barrier(id: string) {
	const { native, journal } = binding()
	const intake = prepareIntake(
		native.libraryId,
		id,
		'https://example.com/article?b=2&a=1#note',
		new Date().toISOString()
	)
	const checkpoint: IntakeCheckpoint = {
		formatVersion: '1',
		intake,
		attemptId: crypto.randomUUID(),
		revision: 0,
		phase: 'pending'
	}
	await journal.create(checkpoint)
	await journal.advance(checkpoint, 'issuing')
}

export async function journalRace(id: string) {
	const { native, journal } = binding()
	const other = createIntakeJournal(native.libraryId, () => true)
	const intake = prepareIntake(
		native.libraryId,
		id,
		'https://example.com/#race',
		new Date().toISOString()
	)
	const checkpoint: IntakeCheckpoint = {
		formatVersion: '1',
		intake,
		attemptId: crypto.randomUUID(),
		revision: 0,
		phase: 'pending'
	}
	const created = await Promise.all([journal.create(checkpoint), other.create(checkpoint)])
	const advanced = await Promise.all([
		journal.advance(checkpoint, 'issuing'),
		other.advance(checkpoint, 'issuing')
	])
	const stale = await journal.advance(checkpoint, 'issuing')
	const foreign = createIntakeJournal(crypto.randomUUID(), () => true)
	return {
		creates: created.filter(Boolean).length,
		advances: advanced.filter(Boolean).length,
		stale,
		foreign: await foreign.get(id)
	}
}

export async function journalValidation() {
	const { native, journal } = binding()
	const ids = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()].sort()
	for (const id of ids) {
		const intake = prepareIntake(
			native.libraryId,
			id,
			'https://example.com/#bounded',
			new Date().toISOString()
		)
		await journal.create({
			formatVersion: '1',
			intake,
			attemptId: crypto.randomUUID(),
			revision: 0,
			phase: 'pending'
		})
	}
	const first = await journal.page(undefined, 2)
	const second = await journal.page(first[1]?.intake.id, 2)
	const paged = [...first, ...second].map((row) => row.intake.id)
	let scopeDenied = false
	try {
		await createIntakeJournal(native.libraryId, () => false).page()
	} catch {
		scopeDenied = true
	}
	const original = await journal.get(ids[0] ?? '')
	if (!original) throw new Error('Missing checkpoint')
	const db = await new Promise<IDBDatabase>((resolve, reject) => {
		const request = indexedDB.open(INTAKE_DATABASE, 1)
		request.onsuccess = () => resolve(request.result)
		request.onerror = () => reject(new Error('Test journal unavailable'))
	})
	try {
		await new Promise<void>((resolve, reject) => {
			const tx = db.transaction('checkpoints', 'readwrite')
			tx.objectStore('checkpoints').put({ ...original, formatVersion: 'future' }, [
				native.libraryId,
				original.intake.id
			])
			tx.oncomplete = () => resolve()
			tx.onabort = () => reject(new Error('Test journal write failed'))
		})
		let readDenied = false,
			replacementDenied = false,
			enumerationDenied = false
		try {
			await journal.get(original.intake.id)
		} catch {
			readDenied = true
		}
		try {
			await journal.create(original)
		} catch {
			replacementDenied = true
		}
		try {
			await journal.page()
		} catch {
			enumerationDenied = true
		}
		const retained = await new Promise<boolean>((resolve, reject) => {
			const tx = db.transaction('checkpoints', 'readonly')
			const request = tx.objectStore('checkpoints').get([native.libraryId, original.intake.id])
			let value = false
			request.onsuccess = () => {
				value =
					request.result.formatVersion === 'future' &&
					request.result.intake.submittedUrl === original.intake.submittedUrl
			}
			tx.oncomplete = () => resolve(value)
			tx.onabort = () => reject(new Error('Test journal read failed'))
		})
		return {
			pagination: JSON.stringify(paged) === JSON.stringify(ids),
			scopeDenied,
			readDenied,
			replacementDenied,
			enumerationDenied,
			retained
		}
	} finally {
		db.close()
	}
}
