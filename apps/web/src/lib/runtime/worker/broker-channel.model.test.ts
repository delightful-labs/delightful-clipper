import { expect, it, vi } from 'vitest'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, type TestSut } from '@xstate/test'
import { setup, types, SimulatedClock, type EventFrom, type SnapshotFrom } from 'xstate'
import { brokerHostClient } from './broker-channel.js'
import type { WorkerRequestIdentity } from 'delightful-local-first/worker/request/contracts'

// External native-resource contract: one pending open can deliver one port or
// fail unknown. Every other received port is disposed; an expired open is never replayed.
const contract = setup({
	schemas: {
		context: types<{ discarded: number }>(),
		events: { REPLY: types(), FOREIGN: types(), EXPIRE: types() }
	}
}).createMachine({
	context: { discarded: 0 },
	initial: 'pending',
	on: { FOREIGN: ({ context }) => ({ context: { discarded: context.discarded + 1 } }) },
	states: {
		pending: { on: { REPLY: { target: 'delivered' }, EXPIRE: { target: 'unknown' } } },
		delivered: {
			on: {
				REPLY: ({ context }) => ({ context: { discarded: context.discarded + 1 } }),
				EXPIRE: {}
			}
		},
		unknown: {
			on: {
				REPLY: ({ context }) => ({ context: { discarded: context.discarded + 1 } }),
				EXPIRE: {}
			}
		}
	}
})
const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	create: async () => {
		const data = new MessageChannel(),
			control = new MessageChannel(),
			clock = new SimulatedClock()
		const scope = crypto.randomUUID()
		let identity: WorkerRequestIdentity | undefined
		let discarded = 0,
			deliveries = 0,
			posts = 0,
			outcomes = 0,
			result = 'pending'
		const retained: MessagePort[] = []
		data.port1.onmessage = (event) => {
			posts++
			identity = {
				scope: event.data.scope,
				requestId: event.data.requestId,
				sequence: event.data.sequence
			}
		}
		const client = brokerHostClient(data.port2, control.port2, scope, {
			clock,
			requestTimeoutMs: 5,
			closeTimeoutMs: 1000,
			onOverdue: () => {},
			onBlocked: () => {}
		})
		void client.open('https://clipper.example/worker.js', 'jazz-runtime:model:generation-0').then(
			(reply) => {
				outcomes++
				deliveries++
				result = 'delivered'
				retained.push(reply.port)
			},
			(error: unknown) => {
				outcomes++
				result = 'unknown'
				expect(error).toMatchObject({
					workerEffectOutcome: 'unknown',
					workerRequest: { scope, sequence: 1 }
				})
			}
		)
		await vi.waitFor(() => expect(identity).toBeDefined(), { interval: 1 })
		return {
			async send(event) {
				if (event.type === 'EXPIRE') {
					clock.increment(5)
					await vi.waitFor(() => expect(outcomes).toBe(1), { interval: 1 })
					return
				}
				const pair = new MessageChannel()
				retained.push(pair.port1, pair.port2)
				let released = false
				pair.port2.addEventListener('close', () => {
					released = true
					discarded++
				})
				const pending = outcomes === 0
				data.port1.postMessage(
					{
						...identity,
						version: 1,
						type: 'OPENED',
						port: pair.port1,
						scope: event.type === 'FOREIGN' ? crypto.randomUUID() : scope
					},
					[pair.port1]
				)
				if (pending && event.type === 'REPLY')
					await vi.waitFor(() => expect(outcomes).toBe(1), { interval: 1 })
				else await vi.waitFor(() => expect(released).toBe(true), { interval: 1 })
			},
			read: () => ({ result, discarded, deliveries, outcomes, posts }),
			dispose: () => {
				client.dispose()
				for (const port of retained) port.close()
				data.port1.close()
				control.port1.close()
			}
		}
	},
	projectModel: (snapshot) => ({
		result: snapshot.matches('pending')
			? 'pending'
			: snapshot.matches('delivered')
				? 'delivered'
				: 'unknown',
		discarded: snapshot.context.discarded,
		deliveries: snapshot.matches('delivered') ? 1 : 0,
		outcomes: snapshot.matches('pending') ? 0 : 1,
		posts: 1
	})
}
it('generates native port delivery, stale replies and deadline races against an independent custody ledger', async () => {
	const { coverage } = await propertyTest(contract, {
		seed: 20261115,
		numRuns: 120,
		maxCommands: 12,
		events: { REPLY: fc.constant({}), FOREIGN: fc.constant({}), EXPIRE: fc.constant({}) },
		sut,
		failures: { dir: '.xstate-test', key: 'clipper-broker-native-custody' }
	})
	assertTestCoverage(coverage, { stateNodes: 1, eventTypes: 1, transitions: 1 })
})
