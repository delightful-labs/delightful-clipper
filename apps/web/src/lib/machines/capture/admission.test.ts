import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { createAdmissionMachine } from './admission.js'
import { prepareIntake } from '../../capture/intake.js'
import type { AdmissionInput, CaptureIntake } from '../../contracts/intake.js'
import type { SyncReceipt } from '../../contracts/storage.js'

function deferred() {
	let resolve!: () => void
	let reject!: (error: Error) => void
	const promise = new Promise<void>((yes, no) => {
		resolve = yes
		reject = no
	})
	return { promise, resolve, reject }
}
function fixture() {
	const intake = prepareIntake(
		crypto.randomUUID(),
		crypto.randomUUID(),
		'https://example.com/#retained',
		new Date().toISOString()
	)
	const input: AdmissionInput = { kind: 'new', intake }
	const recover: AdmissionInput = { kind: 'recover', intakeId: intake.id }
	let current = true
	let row: CaptureIntake | null = null
	const receipt: SyncReceipt = { global: vi.fn(async () => {}) }
	const check = () => {
		if (!current) throw new Error('Scope expired')
	}
	const commit = vi.fn(async () => {
		check()
		row = intake
		return {}
	})
	const persist = vi.fn(async () => {})
	const rollback = vi.fn(() => true)
	const open = vi.fn(async () => {
		check()
		return {}
	})
	const stage = createWorkspaceCreationTransaction<
		CaptureIntake,
		object,
		CaptureIntake | null,
		SyncReceipt,
		object
	>({
		open,
		readLocal: async () => row,
		assess: (existing) =>
			existing ? { outcome: 'blocked', reason: 'Already exists' } : { outcome: 'eligible' },
		stage: () => {
			check()
			return receipt
		},
		commit,
		persistLocal: persist,
		rollback
	})
	const read = vi.fn(async () => row)
	const machine = createAdmissionMachine({
		libraryId: intake.libraryId,
		isCurrent: () => current,
		read,
		insert: stage
	})
	return {
		input,
		recover,
		intake,
		machine,
		commit,
		persist,
		open,
		read,
		rollback,
		receipt,
		setRow: (value: CaptureIntake) => {
			row = value
		},
		scopeLost: () => {
			current = false
		}
	}
}

it('admits a new intake only after native local persistence and exposes its separate global receipt', async () => {
	const f = fixture(),
		local = deferred(),
		entered = deferred()
	f.persist.mockImplementationOnce(async () => {
		entered.resolve()
		await local.promise
	})
	const actor = createActor(f.machine, { input: f.input }).start()
	await entered.promise
	expect(actor.getSnapshot().status).toBe('active')
	expect(f.receipt.global).not.toHaveBeenCalled()
	local.resolve()
	const result = await toPromise(actor)
	expect(result.kind).toBe('admitted')
	expect(f.commit).toHaveBeenCalledOnce()
	expect(actor.getSnapshot().context.request).toBeUndefined()
	if (result.kind !== 'admitted') throw new Error('Expected admission')
	await result.receipts[0].global()
	expect(f.receipt.global).toHaveBeenCalledOnce()
})

it.each(['absent', 'visible'] as const)(
	'never inserts during recovery when the Jazz row is %s',
	async (mode) => {
		const f = fixture()
		if (mode === 'visible') f.setRow(f.intake)
		const actor = createActor(f.machine, { input: f.recover }).start()
		const result = await toPromise(actor)
		expect(result).toEqual(
			mode === 'visible'
				? { kind: 'recovered', intake: f.intake }
				: { kind: 'uncertain', intakeId: f.intake.id }
		)
		expect('receipts' in result).toBe(false)
		expect(f.open).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
		expect(actor.getSnapshot().context.request).toBeUndefined()
	}
)

it('does not replay an unresolved local write after either an optimistic read or a missing read', async () => {
	const f = fixture()
	f.persist.mockRejectedValueOnce(new Error('Unknown local settlement'))
	expect((await toPromise(createActor(f.machine, { input: f.input }).start())).kind).toBe(
		'uncertain'
	)
	expect((await toPromise(createActor(f.machine, { input: f.recover }).start())).kind).toBe(
		'recovered'
	)
	expect(f.commit).toHaveBeenCalledOnce()
	// Another replica may have no knowledge of the same issued operation.
	const other = fixture()
	expect(
		(
			await toPromise(
				createActor(other.machine, { input: { kind: 'recover', intakeId: f.intake.id } }).start()
			)
		).kind
	).toBe('uncertain')
	expect(other.commit).not.toHaveBeenCalled()
})

it('observes an already-existing matching intake without a new write or fabricated receipt', async () => {
	const f = fixture()
	f.setRow(f.intake)
	expect(await toPromise(createActor(f.machine, { input: f.input }).start())).toEqual({
		kind: 'recovered',
		intake: f.intake
	})
	expect(f.commit).not.toHaveBeenCalled()
})

it('blocks a conflicting intake and rejects invalid fresh input before acquiring native resources', async () => {
	const f = fixture()
	f.setRow({
		...f.intake,
		submittedUrl: 'https://other.example/',
		fetchUrl: 'https://other.example/'
	})
	expect((await toPromise(createActor(f.machine, { input: f.input }).start())).kind).toBe('blocked')
	f.open.mockClear()
	const invalid: AdmissionInput = {
		kind: 'new',
		intake: { ...f.intake, fetchUrl: 'https://unrelated.example/' }
	}
	expect((await toPromise(createActor(f.machine, { input: invalid }).start())).kind).toBe('failed')
	expect(f.open).not.toHaveBeenCalled()
	expect(f.commit).not.toHaveBeenCalled()
})

it.each(['open', 'commit', 'local'] as const)(
	'drains %s before completing shutdown',
	async (mode) => {
		const f = fixture(),
			gate = deferred(),
			entered = deferred()
		if (mode === 'open')
			f.open.mockImplementationOnce(async () => {
				entered.resolve()
				await gate.promise
				return {}
			})
		if (mode === 'commit')
			f.commit.mockImplementationOnce(async () => {
				entered.resolve()
				await gate.promise
				f.setRow(f.intake)
				return {}
			})
		if (mode === 'local')
			f.persist.mockImplementationOnce(async () => {
				entered.resolve()
				await gate.promise
			})
		const actor = createActor(f.machine, { input: f.input }).start()
		await entered.promise
		actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('active')
		gate.resolve()
		expect((await toPromise(actor)).kind).toBe('interrupted')
		expect(f.commit.mock.calls.length).toBeLessThanOrEqual(1)
	}
)

it('retains uncertainty through shutdown when local persistence cannot be confirmed', async () => {
	const f = fixture(),
		gate = deferred(),
		entered = deferred()
	f.persist.mockImplementationOnce(async () => {
		entered.resolve()
		await gate.promise
	})
	const actor = createActor(f.machine, { input: f.input }).start()
	await entered.promise
	actor.send({ type: 'SHUTDOWN' })
	gate.reject(new Error('Local settlement unknown'))
	expect((await toPromise(actor)).kind).toBe('uncertain')
	expect(f.commit).toHaveBeenCalledOnce()
})

it('stops old-account progression after an issued local wait settles', async () => {
	const f = fixture(),
		gate = deferred(),
		entered = deferred()
	f.persist.mockImplementationOnce(async () => {
		entered.resolve()
		await gate.promise
	})
	const actor = createActor(f.machine, { input: f.input }).start()
	await entered.promise
	f.scopeLost()
	gate.resolve()
	expect((await toPromise(actor)).kind).toBe('scopeChanged')
	expect(f.read).not.toHaveBeenCalled()
})

it('reports a definite pre-commit failure without claiming uncertain persistence', async () => {
	const f = fixture()
	f.open.mockRejectedValueOnce(new Error('Storage unavailable'))
	expect((await toPromise(createActor(f.machine, { input: f.input }).start())).kind).toBe('failed')
	expect(f.commit).not.toHaveBeenCalled()
})

it('does not convert read failures into absence or authorize insertion', async () => {
	const f = fixture()
	f.read.mockRejectedValueOnce(new Error('Malformed or unavailable native row'))
	expect((await toPromise(createActor(f.machine, { input: f.recover }).start())).kind).toBe(
		'uncertain'
	)
	expect(f.commit).not.toHaveBeenCalled()
})

it('keeps late remote rejection separate from local admission without replaying it', async () => {
	const f = fixture()
	vi.mocked(f.receipt.global).mockRejectedValueOnce(new Error('Remote rejection'))
	const result = await toPromise(createActor(f.machine, { input: f.input }).start())
	if (result.kind !== 'admitted') throw new Error('Expected local admission')
	await expect(result.receipts[0].global()).rejects.toThrow('Remote rejection')
	expect(f.commit).toHaveBeenCalledOnce()
})
