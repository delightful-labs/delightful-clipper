import { expect, it } from 'vitest'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, type TestSut } from '@xstate/test'
import { createActor, setup, toPromise, types, type EventFrom, type SnapshotFrom } from 'xstate'
import type { LinkStatus } from 'jazz-tools'
import { createLocalReadMachine } from './local-read.js'

// Independent reader obligations: a startup miss is pending; one resolution
// permits at most one new read, and cancellation or lost scope forbids it.
const contract = setup({
	schemas: {
		context: types<{ result: 'pending' | 'saved' | 'absent' | 'stopped'; reads: number }>(),
		events: {
			CONNECT: types<{ present: boolean }>(),
			OFFLINE: types(),
			SCOPE: types(),
			CANCEL: types(),
			PULSE: types()
		}
	}
}).createMachine({
	initial: 'pending',
	context: { result: 'pending', reads: 1 },
	states: {
		pending: {
			on: {
				CONNECT: ({ event }) => ({
					target: 'settled',
					context: { result: event.present ? 'saved' : 'absent', reads: 2 }
				}),
				OFFLINE: { target: 'settled', context: { result: 'absent' } },
				SCOPE: { target: 'settled', context: { result: 'absent' } },
				CANCEL: { target: 'settled', context: { result: 'stopped' } },
				PULSE: {}
			}
		},
		settled: { on: { CONNECT: {}, OFFLINE: {}, SCOPE: {}, CANCEL: {}, PULSE: {} } }
	}
})
const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	create: async () => {
		let present = false,
			current = true,
			reads = 0
		const observed = Promise.withResolvers<void>()
		const listeners = new Set<(state: LinkStatus['state']) => void>()
		const actor = createActor(createLocalReadMachine<{ text: string }>(), {
			input: {
				isCurrent: () => current,
				read: async () => {
					reads++
					return present ? { text: 'saved' } : null
				},
				observeConnection: (next) => {
					listeners.add(next)
					next('connecting')
					observed.resolve()
					return () => {
						listeners.delete(next)
					}
				}
			}
		}).start()
		await observed.promise
		return {
			async send(event) {
				if (actor.getSnapshot().status !== 'active') return
				if (event.type === 'CANCEL') {
					actor.stop()
					return
				}
				if (event.type === 'CONNECT') present = event.present
				if (event.type === 'SCOPE') current = false
				const state =
					event.type === 'PULSE' ? 'connecting' : event.type === 'OFFLINE' ? 'offline' : 'connected'
				for (const next of listeners) next(state)
				if (event.type !== 'PULSE') await toPromise(actor)
			},
			read() {
				const snapshot = actor.getSnapshot()
				return {
					result:
						snapshot.status === 'stopped'
							? 'stopped'
							: snapshot.status === 'active'
								? 'pending'
								: (snapshot.output?.row?.text ?? 'absent'),
					reads,
					listeners: listeners.size
				}
			},
			dispose() {
				actor.stop()
				expect(listeners.size).toBe(0)
			}
		}
	},
	projectModel: (snapshot) => ({
		...snapshot.context,
		listeners: snapshot.matches('pending') ? 1 : 0
	})
}
it('generates connection resolution, repeated notifications, cancellation and scope loss without reopening a settled read', async () => {
	const { coverage } = await propertyTest(contract, {
		seed: 61110,
		numRuns: 100,
		maxCommands: 20,
		events: {
			CONNECT: fc.record({ present: fc.boolean() }),
			OFFLINE: fc.constant({}),
			SCOPE: fc.constant({}),
			CANCEL: fc.constant({}),
			PULSE: fc.constant({})
		},
		sut,
		failures: { dir: '.xstate-test', key: 'clipper-reader-startup' }
	})
	assertTestCoverage(coverage, { stateNodes: 1, eventTypes: 1, transitions: 1 })
})
