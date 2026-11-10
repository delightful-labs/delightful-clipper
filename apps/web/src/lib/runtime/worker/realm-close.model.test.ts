import { it } from 'vitest'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, type TestSut } from '@xstate/test'
import { setup, types, SimulatedClock, waitFor, type EventFrom, type SnapshotFrom } from 'xstate'
import { createWorkerHostFixture } from './host-machine.test-support.js'

// Independent promise/receipt contract, with no application binding states:
// feedback expiry never settles a native close, and only completion closes once.
const contract = setup({
	schemas: {
		context: types<{ overdue: boolean }>(),
		events: { EXPIRE: types(), COMPLETE: types(), SHUTDOWN: types() }
	}
}).createMachine({
	context: { overdue: false },
	initial: 'waiting',
	states: {
		waiting: {
			on: {
				EXPIRE: { target: 'overdue', context: { overdue: true } },
				COMPLETE: { target: 'closed' },
				SHUTDOWN: {}
			}
		},
		overdue: { on: { EXPIRE: {}, COMPLETE: { target: 'closed' }, SHUTDOWN: {} } },
		closed: { on: { EXPIRE: {}, COMPLETE: {}, SHUTDOWN: {} } }
	}
})
const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	create: async () => {
		const closing = Promise.withResolvers<void>(),
			clock = new SimulatedClock()
		const f = createWorkerHostFixture(undefined, undefined, undefined, {
			clock,
			closePolicy: { sessionCloseMs: 5 }
		})
		f.close.mockImplementation(() => closing.promise)
		f.actor.start()
		f.actor.send({ type: 'SHUTDOWN' })
		await waitFor(f.actor, (s) => s.matches('closingSession'), { timeout: 1000 })
		return {
			async send(event) {
				if (event.type === 'EXPIRE') clock.increment(5)
				else if (event.type === 'COMPLETE') {
					closing.resolve()
					await waitFor(f.actor, (s) => s.status === 'done', { timeout: 1000 })
				} else if (f.actor.getSnapshot().status === 'active') f.actor.send(event)
			},
			read: () => ({
				closed: f.actor.getSnapshot().status === 'done',
				overdue: f.actor.getSnapshot().context.closeIssue?.reason === 'overdue',
				closes: f.close.mock.calls.length
			}),
			async dispose() {
				closing.resolve()
				await waitFor(f.actor, (s) => s.status === 'done', { timeout: 1000 })
				f.owner.stop()
			}
		}
	},
	projectModel: (snapshot) => ({
		closed: snapshot.matches('closed'),
		overdue: snapshot.context.overdue,
		closes: 1
	})
}
it('generates exact-boundary expiry/completion and repeated shutdown schedules without false closure or replay', async () => {
	const { coverage } = await propertyTest(contract, {
		seed: 20261116,
		numRuns: 120,
		maxCommands: 12,
		events: { EXPIRE: fc.constant({}), COMPLETE: fc.constant({}), SHUTDOWN: fc.constant({}) },
		sut,
		failures: { dir: '.xstate-test', key: 'clipper-realm-close' }
	})
	assertTestCoverage(coverage, { stateNodes: 1, eventTypes: 1, transitions: 1 })
})
