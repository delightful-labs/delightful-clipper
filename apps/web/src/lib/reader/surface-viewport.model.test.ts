import { it } from 'vitest'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, type TestSut } from '@xstate/test'
import {
	setup,
	types,
	createActor,
	SimulatedClock,
	type EventFrom,
	type SnapshotFrom
} from 'xstate'
import { surfaceViewportMachine } from './surface-viewport.js'

// Receipt ledger: expiry changes the observer outcome, never native custody.
// Only the matching native settlement can release custody, once.
const contract = setup({
	schemas: {
		context: types<{ overdue: boolean }>(),
		events: { EXPIRE: types(), WRONG: types(), SETTLE: types(), DETACH: types() }
	}
}).createMachine({
	context: { overdue: false },
	initial: 'held',
	states: {
		held: {
			on: {
				EXPIRE: { target: 'overdue', context: { overdue: true } },
				WRONG: {},
				DETACH: {},
				SETTLE: { target: 'settled' }
			}
		},
		overdue: { on: { EXPIRE: {}, WRONG: {}, DETACH: {}, SETTLE: { target: 'settled' } } },
		settled: { on: { EXPIRE: {}, WRONG: {}, DETACH: {}, SETTLE: {} } }
	}
})
const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	create: async () => {
		const channel = new MessageChannel(),
			clock = new SimulatedClock(),
			attachmentId = crypto.randomUUID()
		channel.port1.start()
		const actor = createActor(surfaceViewportMachine, {
			clock,
			input: {
				port: channel.port2,
				attachmentId,
				position: undefined,
				replyTimeoutMs: 5,
				now: () => clock.now()
			}
		}).start()
		return {
			async send(event) {
				if (event.type === 'EXPIRE') clock.increment(5)
				else if (event.type === 'DETACH') actor.send(event)
				else if (actor.getSnapshot().status === 'active') {
					const delivered = new Promise<void>((resolve) =>
						channel.port2.addEventListener('message', () => resolve(), { once: true })
					)
					channel.port1.postMessage({
						type: 'VIEWPORT_SETTLED',
						outcome: 'closed',
						attachmentId: event.type === 'WRONG' ? crypto.randomUUID() : attachmentId
					})
					await delivered
				}
			},
			read: () => ({
				settled: actor.getSnapshot().status === 'done',
				overdue: actor.getSnapshot().context.outcome === 'overdue'
			}),
			dispose: () => {
				actor.stop()
				channel.port1.close()
				channel.port2.close()
			}
		}
	},
	projectModel: (snapshot) => ({
		settled: snapshot.matches('settled'),
		overdue: snapshot.context.overdue
	})
}
it('generates expiry, wrong-receipt, repeated-detach and late-settlement schedules without fabricated closure', async () => {
	const { coverage } = await propertyTest(contract, {
		seed: 20261118,
		numRuns: 120,
		maxCommands: 12,
		events: {
			EXPIRE: fc.constant({}),
			WRONG: fc.constant({}),
			DETACH: fc.constant({}),
			SETTLE: fc.constant({})
		},
		sut,
		failures: { dir: '.xstate-test', key: 'clipper-reader-replies' }
	})
	assertTestCoverage(coverage, { stateNodes: 1, eventTypes: 1, transitions: 1 })
})
