import { expect, it } from 'vitest'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, type TestSut } from '@xstate/test'
import { setup, types, waitFor, type EventFrom, type SnapshotFrom } from 'xstate'
import { selectAcquiredSession } from 'delightful-local-first/session/workflow'
import { createWorkerHostFixture } from './host-machine.test-support.js'

// Independent resource contract: shutdown cannot close an acquisition whose
// resource has not arrived; a late resource must be closed exactly once.
const contract = setup({
	schemas: { events: { ACQUIRED: types(), SHUTDOWN: types() } }
}).createMachine({
	initial: 'opening',
	states: {
		opening: { on: { ACQUIRED: { target: 'ready' }, SHUTDOWN: { target: 'draining' } } },
		ready: { on: { ACQUIRED: {}, SHUTDOWN: { target: 'closed' } } },
		draining: { on: { ACQUIRED: { target: 'closed' }, SHUTDOWN: {} } },
		closed: { on: { ACQUIRED: {}, SHUTDOWN: {} } }
	}
})
const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	create: () => {
		const acquisition = Promise.withResolvers<void>()
		const f = createWorkerHostFixture(acquisition.promise)
		let shutdown = false,
			acquired = false
		f.actor.start()
		return {
			async send(event) {
				if (event.type === 'ACQUIRED') {
					acquired = true
					acquisition.resolve()
					if (!shutdown) await waitFor(f.owner, (snapshot) => !!selectAcquiredSession(snapshot))
				} else {
					shutdown = true
					f.actor.send(event)
				}
				if (shutdown && acquired) await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
			},
			read: () => ({
				closed: f.actor.getSnapshot().status === 'done',
				closes: f.close.mock.calls.length
			}),
			async dispose() {
				acquisition.resolve()
				f.actor.send({ type: 'SHUTDOWN' })
				await waitFor(f.actor, (snapshot) => snapshot.status === 'done')
				expect(f.close).toHaveBeenCalledOnce()
				f.owner.stop()
			}
		}
	},
	projectModel: (snapshot) => ({
		closed: snapshot.matches('closed'),
		closes: snapshot.matches('closed') ? 1 : 0
	})
}
it('generates shutdown and duplicate acquisition completion in either order', async () => {
	const { coverage } = await propertyTest(contract, {
		seed: 60382,
		numRuns: 60,
		maxCommands: 12,
		events: { ACQUIRED: fc.constant({}), SHUTDOWN: fc.constant({}) },
		sut,
		failures: { dir: '.xstate-test', key: 'clipper-worker-acquisition-drain' }
	})
	assertTestCoverage(coverage, { stateNodes: 1, eventTypes: 1, transitions: 1 })
})
