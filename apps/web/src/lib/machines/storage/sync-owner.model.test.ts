import { expect, it } from 'vitest'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, type TestSut } from '@xstate/test'
import { createActor, setup, types, type SnapshotFrom, type EventFrom } from 'xstate'
import type { SyncReport } from '../../contracts/storage.js'
import { syncOwnerMachine } from './sync-owner.js'

type Job = { document: string; id: number; settled: boolean }
type Ledger = {
	issued: number
	current: Record<string, number>
	jobs: Job[]
	reports: SyncReport[]
}
function watch(ledger: Ledger, document: string): Ledger {
	const id = ledger.issued + 1
	return {
		...ledger,
		issued: id,
		current: { ...ledger.current, [document]: id },
		jobs: [...ledger.jobs, { document, id, settled: false }]
	}
}
function settle(ledger: Ledger, newest: boolean): Ledger {
	const pending = ledger.jobs.filter((job) => !job.settled)
	const job = newest ? pending.at(-1) : pending[0]
	if (!job) return ledger
	const current = { ...ledger.current },
		reports = [...ledger.reports]
	if (current[job.document] === job.id) {
		reports.push({ type: 'SYNC', id: job.document, status: newest ? 'rejected' : 'accepted' })
		delete current[job.document]
	}
	return {
		...ledger,
		current,
		reports,
		jobs: ledger.jobs.map((item) => (item.id === job.id ? { ...item, settled: true } : item))
	}
}
// Independent contract: only the latest observer for each document may report.
// Replacing/stopping an observer never cancels or repeats the original receipt.
const model = setup({
	schemas: {
		context: types<Ledger>(),
		events: {
			WATCH_A: types(),
			WATCH_B: types(),
			RESOLVE_OLDEST: types(),
			REJECT_NEWEST: types(),
			SHUTDOWN: types()
		}
	}
}).createMachine({
	initial: 'watching',
	context: { issued: 0, current: {}, jobs: [], reports: [] },
	states: {
		watching: {
			on: {
				WATCH_A: ({ context }) => ({ context: watch(context, 'A') }),
				WATCH_B: ({ context }) => ({ context: watch(context, 'B') }),
				RESOLVE_OLDEST: ({ context }) => ({ context: settle(context, false) }),
				REJECT_NEWEST: ({ context }) => ({ context: settle(context, true) }),
				SHUTDOWN: { target: 'closed' }
			}
		},
		closed: {
			on: { WATCH_A: {}, WATCH_B: {}, RESOLVE_OLDEST: {}, REJECT_NEWEST: {}, SHUTDOWN: {} }
		}
	}
})
it('generates receipt replacement, late settlement and shutdown schedules against an independent ledger', async () => {
	const sut: TestSut<SnapshotFrom<typeof model>, EventFrom<typeof model>> = {
		create: async () => {
			const reports: SyncReport[] = [],
				jobs: { gate: ReturnType<typeof Promise.withResolvers<void>>; settled: boolean }[] = []
			let started = 0,
				requiredRejections = 0
			const receiver = createActor(
				setup({ schemas: { events: { SYNC: types<Omit<SyncReport, 'type'>>() } } }).createMachine({
					on: {
						SYNC: ({ event }, enq) => {
							enq(() => reports.push(event))
						}
					}
				})
			).start()
			const actor = createActor(syncOwnerMachine, {
				input: { reportTo: receiver },
				onRejectedEvent: (rejection) => {
					// Repeated external commands after closure are benign stopped deliveries.
					if (
						rejection.eventOrigin === 'actor' &&
						(rejection.event.type === 'SHUTDOWN' || rejection.event.type === 'SYNC')
					)
						requiredRejections++
				}
			}).start()
			return {
				send: async (event) => {
					if (event.type === 'WATCH_A' || event.type === 'WATCH_B') {
						if (actor.getSnapshot().status === 'active') {
							const gate = Promise.withResolvers<void>()
							jobs.push({ gate, settled: false })
							actor.send({
								type: 'WATCH',
								id: event.type === 'WATCH_A' ? 'A' : 'B',
								receipts: [
									{
										global: () => {
											started++
											return gate.promise
										}
									}
								]
							})
						} else actor.send({ type: 'WATCH', id: 'A', receipts: [] })
					} else if (event.type === 'SHUTDOWN') actor.send(event)
					else {
						const pending = jobs.filter((job) => !job.settled)
						const job = event.type === 'REJECT_NEWEST' ? pending.at(-1) : pending[0]
						if (job) {
							job.settled = true
							if (event.type === 'REJECT_NEWEST') job.gate.reject(new Error('Remote rejection'))
							else job.gate.resolve()
						}
					}
					await new Promise<void>((resolve) => setImmediate(resolve))
				},
				read: () => ({
					started,
					reports: [...reports],
					closed: actor.getSnapshot().status === 'done',
					requiredRejections
				}),
				dispose: () => {
					actor.stop()
					receiver.stop()
					for (const job of jobs) job.gate.resolve()
				}
			}
		},
		projectModel: (snapshot) => ({
			started: snapshot.context.issued,
			reports: snapshot.context.reports,
			closed: snapshot.matches('closed'),
			requiredRejections: 0
		})
	}
	const { coverage } = await propertyTest(model, {
		seed: 20261120,
		numRuns: 120,
		maxCommands: 14,
		events: {
			WATCH_A: fc.constant({}),
			WATCH_B: fc.constant({}),
			RESOLVE_OLDEST: fc.constant({}),
			REJECT_NEWEST: fc.constant({}),
			SHUTDOWN: fc.constant({})
		},
		sut,
		failures: { dir: '.xstate-test', key: 'clipper-receipt-observer' }
	})
	assertTestCoverage(coverage, { stateNodes: 1, eventTypes: 1, transitions: 1 })
	expect(coverage).toBeDefined()
})
