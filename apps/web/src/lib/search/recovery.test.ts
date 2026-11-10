import { expect, it, vi } from 'vitest'
import { createActor, SimulatedClock, toPromise } from 'xstate'
import type { SearchCapability } from '../contracts/search.js'
import type { SearchWorkerInput, SearchWorkerOutput } from './protocol.js'
import type { SearchDocument } from './schema.js'
import { createSearchMachine, selectSearchView } from './machine.js'

function fixture() {
	const clock = new SimulatedClock()
	let time = 0
	const gates: ReturnType<typeof Promise.withResolvers<SearchDocument[]>>[] = []
	const signals: AbortSignal[] = []
	const reports: ((event: SearchWorkerOutput) => void)[] = []
	const posted: SearchWorkerInput[] = []
	const dispose = vi.fn(),
		unsubscribe = vi.fn()
	const load = vi.fn<SearchCapability['load']>((_rows, signal) => {
		signals.push(signal)
		const gate = Promise.withResolvers<SearchDocument[]>()
		gates.push(gate)
		return gate.promise
	})
	const actor = createActor(createSearchMachine(), {
		clock,
		input: {
			now: () => time,
			waits: { loadMs: 10, indexMs: 10, queryMs: 10 },
			capability: {
				libraryId: 'bound-library',
				isCurrent: () => true,
				load,
				observe: () => unsubscribe,
				open: (report) => {
					reports.push(report)
					return { dispose, post: (message) => posted.push(message) }
				}
			}
		}
	}).start()
	const advance = (ms: number) => {
		time += ms
		clock.increment(ms)
	}
	actor.send({ type: 'ACTIVATE' })
	advance(16)
	return {
		actor,
		load,
		signals,
		reports,
		gates,
		posted,
		dispose,
		unsubscribe,
		advance,
		elapseWithoutTimers: (ms: number) => {
			time += ms
		},
		settle: () => gates.at(-1)!.resolve([]),
		async close() {
			actor.send({ type: 'STOP' })
			for (const gate of gates) gate.resolve([])
			await toPromise(actor)
		}
	}
}

it.each(['deadline', 'worker-error'] as const)(
	'drains an issued load after %s before permitting retry and fences the old worker',
	async (failure) => {
		const f = fixture()
		try {
			await vi.waitFor(() => expect(f.load).toHaveBeenCalledOnce())
			if (failure === 'deadline') f.advance(10)
			else f.reports[0]!({ type: 'WORKER_ERROR' })
			expect(selectSearchView(f.actor.getSnapshot())).toMatchObject({
				canRetry: false,
				message: { text: 'Search is unavailable.', variant: 'error' }
			})
			expect(f.signals[0]?.aborted).toBe(true)
			for (let i = 0; i < 4; i++) {
				f.actor.send({ type: 'RETRY' })
				f.actor.send({ type: 'DIRTY' })
			}
			expect(f.load).toHaveBeenCalledOnce()
			expect(f.dispose).toHaveBeenCalledOnce()
			f.settle()
			await vi.waitFor(() => expect(selectSearchView(f.actor.getSnapshot()).canRetry).toBe(true))
			expect(f.posted).toEqual([])
			f.actor.send({ type: 'RETRY' })
			f.advance(16)
			await vi.waitFor(() => expect(f.load).toHaveBeenCalledTimes(2))
			f.reports[0]!({ type: 'WORKER_ERROR' })
			expect(f.actor.getSnapshot().matches({ running: 'loading' })).toBe(true)
			expect(f.reports).toHaveLength(2)
		} finally {
			await f.close()
		}
	}
)

it.each(['load', 'index', 'query'] as const)(
	'refuses a %s completion at the exact deadline before timer delivery',
	async (stage) => {
		const f = fixture()
		try {
			await vi.waitFor(() => expect(f.load).toHaveBeenCalledOnce())
			if (stage === 'load') {
				f.elapseWithoutTimers(10)
				f.settle()
			} else {
				f.settle()
				await vi.waitFor(() =>
					expect(f.actor.getSnapshot().matches({ running: 'indexing' })).toBe(true)
				)
				const generation = f.actor.getSnapshot().context.generation
				if (stage === 'query') f.reports[0]!({ type: 'INDEX_READY', generation })
				f.elapseWithoutTimers(10)
				f.reports[0]!(
					stage === 'index'
						? { type: 'INDEX_READY', generation }
						: { type: 'RESULT', generation, query: '', ids: [crypto.randomUUID()] }
				)
			}
			await vi.waitFor(() => expect(f.actor.getSnapshot().matches('failed')).toBe(true))
			expect(selectSearchView(f.actor.getSnapshot()).ids).toBeUndefined()
			expect(f.dispose).toHaveBeenCalledOnce()
		} finally {
			await f.close()
		}
	}
)

it.each(['index', 'query'] as const)(
	'retires a silent %s worker and permits explicit recreation',
	async (stage) => {
		const f = fixture()
		try {
			await vi.waitFor(() => expect(f.load).toHaveBeenCalledOnce())
			f.settle()
			await vi.waitFor(() =>
				expect(f.actor.getSnapshot().matches({ running: 'indexing' })).toBe(true)
			)
			if (stage === 'query')
				f.reports[0]!({ type: 'INDEX_READY', generation: f.actor.getSnapshot().context.generation })
			f.advance(10)
			expect(f.actor.getSnapshot().matches('failed')).toBe(true)
			expect(selectSearchView(f.actor.getSnapshot()).canRetry).toBe(true)
			expect(f.dispose).toHaveBeenCalledOnce()
			f.actor.send({ type: 'RETRY' })
			f.advance(16)
			await vi.waitFor(() => expect(f.load).toHaveBeenCalledTimes(2))
		} finally {
			await f.close()
		}
	}
)

it('keeps shutdown pending through a noncancellable load and never publishes its late private content', async () => {
	const f = fixture()
	await vi.waitFor(() => expect(f.load).toHaveBeenCalledOnce())
	f.actor.send({ type: 'STOP' })
	f.advance(10_000)
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.actor.getSnapshot().context.rows).toEqual([])
	expect(f.signals[0]?.aborted).toBe(true)
	f.settle()
	await toPromise(f.actor)
	expect(f.posted).toEqual([])
	expect(f.dispose).toHaveBeenCalledOnce()
	expect(f.unsubscribe).toHaveBeenCalledOnce()
})
