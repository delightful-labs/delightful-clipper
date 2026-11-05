import { createActor, SimulatedClock, toPromise, waitFor } from 'xstate'
import { beforeEach, expect, it, vi } from 'vitest'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { libraryMachine } from '../machines/capture/library.js'
import { testLibraryCapability } from '../machines/capture/library.test-support.js'
import type { FakeDataPlan } from './plan.js'
import { createFakeDataMachine } from './machine.js'
const prepare = vi.hoisted(() => vi.fn(async () => []))
vi.mock('./plan.js', () => ({ prepareFakeData: prepare }))
beforeEach(() => {
	prepare.mockClear()
})
function fixture(
	options: {
		enabled?: boolean
		authority?: () => Promise<{ hasData: boolean; owned: boolean }>
		uncertain?: boolean
	} = {}
) {
	const local = vi.fn(async () => ({ hasData: false, owned: true }))
	const authority = vi.fn(options.authority ?? (async () => ({ hasData: false, owned: true })))
	const write = vi.fn(() => ({ issued: true }))
	const stage = createWorkspaceCreationTransaction<
		FakeDataPlan,
		{ opened: boolean },
		null,
		number,
		{ issued: boolean }
	>({
		open: () => ({ opened: true }),
		readLocal: () => null,
		assess: () => ({ outcome: 'eligible' }),
		stage: () => 24,
		commit: write,
		persistLocal: async () => {
			if (options.uncertain) throw new Error('Uncertain settlement')
		},
		rollback: async () => true
	})
	const machine = createFakeDataMachine({
		enabled: options.enabled ?? true,
		libraryId: 'library',
		isCurrent: () => true,
		stage,
		local,
		authority
	})
	return { machine, local, authority, write }
}
it('disabled mode does not read, import Faker or issue writes', async () => {
	const f = fixture({ enabled: false })
	expect(await toPromise(createActor(f.machine).start())).toBe('skipped')
	expect(f.local).not.toHaveBeenCalled()
	expect(f.authority).not.toHaveBeenCalled()
	expect(prepare).not.toHaveBeenCalled()
	expect(f.write).not.toHaveBeenCalled()
})
it('does not treat authoritative content or missing ownership as permission to seed', async () => {
	for (const rows of [
		{ hasData: true, owned: true },
		{ hasData: false, owned: false }
	]) {
		const f = fixture({ authority: async () => rows })
		expect(await toPromise(createActor(f.machine).start())).toBe('skipped')
		expect(f.write).not.toHaveBeenCalled()
	}
	expect(prepare).not.toHaveBeenCalled()
})
it('bounds unavailable-authority observation and permits immediate shutdown before writing', async () => {
	const f = fixture({ authority: () => new Promise(() => {}) }),
		clock = new SimulatedClock()
	const actor = createActor(f.machine, { clock }).start()
	await waitFor(actor, (snapshot) => snapshot.matches('authority'))
	clock.increment(5000)
	expect(await toPromise(actor)).toBe('skipped')
	const other = createActor(f.machine).start()
	await waitFor(other, (snapshot) => snapshot.matches('authority'))
	other.send({ type: 'SHUTDOWN' })
	expect(await toPromise(other)).toBe('closed')
	expect(prepare).not.toHaveBeenCalled()
	expect(f.write).not.toHaveBeenCalled()
})
it('retains uncertain completion and never automatically replays the batch', async () => {
	const f = fixture({ uncertain: true })
	expect(await toPromise(createActor(f.machine).start())).toBe('unknown')
	expect(f.write).toHaveBeenCalledOnce()
})

it('keeps the library owner alive until an issued seed settles during shutdown', async () => {
	const gate = Promise.withResolvers<void>(),
		entered = Promise.withResolvers<void>()
	const stage = createWorkspaceCreationTransaction<
		FakeDataPlan,
		{ opened: boolean },
		null,
		number,
		{ issued: boolean }
	>({
		open: () => ({ opened: true }),
		readLocal: () => null,
		assess: () => ({ outcome: 'eligible' }),
		stage: () => 24,
		commit: () => ({ issued: true }),
		persistLocal: async () => {
			entered.resolve()
			await gate.promise
		},
		rollback: async () => true
	})
	const seed = createFakeDataMachine({
		enabled: true,
		libraryId: 'library',
		isCurrent: () => true,
		stage,
		local: async () => ({ hasData: false, owned: true }),
		authority: async () => ({ hasData: false, owned: true })
	})
	const candidate = {
		id: crypto.randomUUID(),
		title: 'Existing',
		text: 'Text',
		html: '<p>Text</p>',
		finalUrl: 'https://example.com/',
		submittedUrl: 'https://example.com/',
		provenance: '{}',
		imagesMissing: false
	}
	const cap = testLibraryCapability(candidate, {
		spawnFakeData: (spawn) => spawn(seed, { input: undefined })
	})
	const actor = createActor(libraryMachine, { input: cap }).start()
	await entered.promise
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().status).toBe('active')
	gate.resolve()
	await toPromise(actor)
	expect(actor.getSnapshot().context.capability).toBeUndefined()
	expect(actor.getSnapshot().context.fakeDataRef).toBeUndefined()
})
