import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { createAdmissionMachine } from './admission.js'
import { prepareIntake } from '../../capture/intake.js'
import type { CaptureIntake, IntakeCheckpoint, IntakeJournal } from '../../contracts/intake.js'
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
	const input = { intake, attemptId: crypto.randomUUID() }
	let current = true
	let checkpoint: IntakeCheckpoint | null = null
	let row: CaptureIntake | null = null
	const receipts: SyncReceipt = { global: vi.fn(async () => {}) }
	const journal: IntakeJournal = {
		get: vi.fn(async () => (checkpoint ? structuredClone(checkpoint) : null)),
		create: vi.fn(async (value) => {
			if (checkpoint) return false
			checkpoint = structuredClone(value)
			return true
		}),
		advance: vi.fn(async (previous, phase) => {
			if (!checkpoint || checkpoint.revision !== previous.revision) return null
			checkpoint = { ...checkpoint, phase, revision: checkpoint.revision + 1 }
			return structuredClone(checkpoint)
		}),
		page: async () => (checkpoint ? [structuredClone(checkpoint)] : [])
	}
	const commit = vi.fn(async () => {
		row = intake
		return {}
	})
	const persist = vi.fn(async () => {})
	const rollback = vi.fn(() => true)
	const open = vi.fn(async () => ({}))
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
		stage: () => receipts,
		commit,
		persistLocal: persist,
		rollback
	})
	const read = vi.fn(async () => row)
	const machine = createAdmissionMachine({
		libraryId: intake.libraryId,
		isCurrent: () => current,
		journal,
		read,
		insert: stage
	})
	return {
		input,
		machine,
		journal,
		commit,
		persist,
		open,
		read,
		rollback,
		receipts,
		checkpoint: () => checkpoint,
		setCheckpoint: (value: IntakeCheckpoint) => {
			checkpoint = value
		},
		setRow: (value: CaptureIntake) => {
			row = value
		},
		scopeLost: () => {
			current = false
		}
	}
}

it('admits only after the durable barrier, native local wait and final checkpoint', async () => {
	const f = fixture()
	const local = deferred(),
		entered = deferred()
	f.persist.mockImplementationOnce(async () => {
		entered.resolve()
		await local.promise
	})
	const actor = createActor(f.machine, { input: f.input }).start()
	await entered.promise
	expect(f.checkpoint()?.phase).toBe('issuing')
	expect(actor.getSnapshot().status).toBe('active')
	expect(f.receipts.global).not.toHaveBeenCalled()
	local.resolve()
	const result = await toPromise(actor)
	expect(result.kind).toBe('admitted')
	expect(f.checkpoint()?.phase).toBe('admitted')
	expect(f.commit).toHaveBeenCalledTimes(1)
	expect(actor.getSnapshot().context.request).toBeUndefined()
	expect(actor.getSnapshot().context.checkpoint).toBeUndefined()
	expect(actor.getSnapshot().context.receipts).toEqual([])
	if (result.kind !== 'admitted') throw new Error('Expected admission')
	await result.receipts[0]?.global()
	expect(f.receipts.global).toHaveBeenCalledOnce()
})

it.each(['absent', 'optimistic'] as const)(
	'does not replay an issued intake when the local row is %s',
	async (mode) => {
		const f = fixture()
		f.setCheckpoint({
			formatVersion: '1',
			intake: f.input.intake,
			attemptId: f.input.attemptId,
			phase: 'issuing',
			revision: 1
		})
		if (mode === 'optimistic') f.setRow(f.input.intake)
		expect((await toPromise(createActor(f.machine, { input: f.input }).start())).kind).toBe(
			'uncertain'
		)
		expect(f.commit).not.toHaveBeenCalled()
		expect(f.checkpoint()?.phase).toBe('issuing')
	}
)

it('reopens a durable admitted checkpoint without writing again or inventing a global receipt', async () => {
	const f = fixture()
	f.setCheckpoint({
		formatVersion: '1',
		intake: f.input.intake,
		attemptId: f.input.attemptId,
		phase: 'admitted',
		revision: 2
	})
	f.setRow(f.input.intake)
	expect(await toPromise(createActor(f.machine, { input: f.input }).start())).toEqual({
		kind: 'admitted',
		intakeId: f.input.intake.id,
		receipts: []
	})
	expect(f.commit).not.toHaveBeenCalled()
})

it.each(['checkpoint', 'barrier'] as const)(
	'does not start a native insert when %s persistence fails',
	async (mode) => {
		const f = fixture()
		if (mode === 'checkpoint') vi.mocked(f.journal.create).mockRejectedValueOnce(new Error('quota'))
		else vi.mocked(f.journal.advance).mockRejectedValueOnce(new Error('local outcome unknown'))
		expect((await toPromise(createActor(f.machine, { input: f.input }).start())).kind).toBe(
			mode === 'checkpoint' ? 'failed' : 'uncertain'
		)
		expect(f.commit).not.toHaveBeenCalled()
	}
)

it.each(['open', 'commit', 'local'] as const)(
	'drains %s before completing shutdown and retains recovery evidence',
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
		expect(f.checkpoint()).not.toBeNull()
		expect(f.commit.mock.calls.length).toBeLessThanOrEqual(1)
	}
)

it('keeps unresolved local settlement uncertain through shutdown without replay', async () => {
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
	gate.reject(new Error('Unknown local settlement'))
	expect((await toPromise(actor)).kind).toBe('uncertain')
	expect(f.checkpoint()?.phase).toBe('issuing')
	expect((await toPromise(createActor(f.machine, { input: f.input }).start())).kind).toBe(
		'uncertain'
	)
	expect(f.commit).toHaveBeenCalledOnce()
})

it('invalidates a scope during local settlement without advancing old-account work', async () => {
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
	expect(f.checkpoint()?.phase).toBe('issuing')
})

it('blocks a reused ID with different submitted evidence and rejects invalid input before journaling', async () => {
	const f = fixture()
	f.setCheckpoint({
		formatVersion: '1',
		intake: {
			...f.input.intake,
			submittedUrl: 'https://other.example/',
			fetchUrl: 'https://other.example/'
		},
		attemptId: f.input.attemptId,
		phase: 'pending',
		revision: 0
	})
	expect((await toPromise(createActor(f.machine, { input: f.input }).start())).kind).toBe('blocked')
	const invalid = {
		...f.input,
		intake: { ...f.input.intake, fetchUrl: 'https://unrelated.example/' }
	}
	expect((await toPromise(createActor(f.machine, { input: invalid }).start())).kind).toBe('failed')
	expect(f.journal.create).not.toHaveBeenCalled()
	expect(f.commit).not.toHaveBeenCalled()
})

it('reconciles a competing barrier claim without issuing another native insert', async () => {
	const f = fixture()
	vi.mocked(f.journal.advance).mockImplementationOnce(async (previous) => {
		f.setCheckpoint({ ...previous, phase: 'issuing', revision: previous.revision + 1 })
		return null
	})
	expect((await toPromise(createActor(f.machine, { input: f.input }).start())).kind).toBe(
		'uncertain'
	)
	expect(f.commit).not.toHaveBeenCalled()
})

it('retains uncertainty if the final checkpoint cannot confirm a locally persisted intake', async () => {
	const f = fixture()
	const advance = f.journal.advance
	f.journal.advance = vi.fn(async (previous, phase) => {
		if (phase === 'admitted') throw new Error('Final checkpoint not confirmed')
		return advance(previous, phase)
	})
	expect((await toPromise(createActor(f.machine, { input: f.input }).start())).kind).toBe(
		'uncertain'
	)
	expect(f.checkpoint()?.phase).toBe('issuing')
	expect(f.commit).toHaveBeenCalledOnce()
	expect((await toPromise(createActor(f.machine, { input: f.input }).start())).kind).toBe(
		'uncertain'
	)
	expect(f.commit).toHaveBeenCalledOnce()
})

it('keeps a late remote rejection separate from local admission and never retries the insert', async () => {
	const f = fixture()
	vi.mocked(f.receipts.global).mockRejectedValue(new Error('Remote rejection'))
	const result = await toPromise(createActor(f.machine, { input: f.input }).start())
	if (result.kind !== 'admitted') throw new Error('Expected local admission')
	await expect(result.receipts[0]?.global()).rejects.toThrow('Remote rejection')
	expect(f.checkpoint()?.phase).toBe('admitted')
	expect(f.commit).toHaveBeenCalledOnce()
})

it.each(['create', 'barrier'] as const)(
	'drains an issued %s checkpoint write on shutdown',
	async (mode) => {
		const f = fixture(),
			gate = deferred(),
			entered = deferred()
		if (mode === 'create') {
			const create = f.journal.create
			f.journal.create = vi.fn(async (value) => {
				entered.resolve()
				await gate.promise
				return create(value)
			})
		} else {
			const advance = f.journal.advance
			f.journal.advance = vi.fn(async (previous, phase) => {
				entered.resolve()
				await gate.promise
				return advance(previous, phase)
			})
		}
		const actor = createActor(f.machine, { input: f.input }).start()
		await entered.promise
		actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('active')
		gate.resolve()
		expect((await toPromise(actor)).kind).toBe('interrupted')
		expect(f.commit).not.toHaveBeenCalled()
		expect(f.checkpoint()?.phase).toBe(mode === 'create' ? 'pending' : 'issuing')
	}
)
