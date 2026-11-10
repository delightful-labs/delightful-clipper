import { it } from 'vitest'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, type TestSut } from '@xstate/test'
import { createActor, setup, types, type EventFrom, type SnapshotFrom } from 'xstate'
import { z } from 'zod'
import { createBrowserWorkerJob } from './browser-worker-job.js'
import { TestJobWorker } from './browser-worker-job.test-support.js'

const schema = z.object({ value: z.number().int() })
const job = createBrowserWorkerJob<string, z.infer<typeof schema>>()
type Scenario = 'normal' | 'pre-abort' | 'construction' | 'post'
type Outcome = 'pending' | 'replied' | 'failed' | 'cancelled' | 'stopped'
function ledger(scenario: Scenario) {
	return setup({
		schemas: {
			context: types<{ result: Outcome }>(),
			events: {
				VALID: types(),
				INVALID: types(),
				ERROR: types(),
				MESSAGE_ERROR: types(),
				ABORT: types(),
				CANCEL: types(),
				STOP: types()
			}
		}
	}).createMachine({
		initial: scenario === 'normal' ? 'held' : 'settled',
		context: {
			result: scenario === 'normal' ? 'pending' : scenario === 'pre-abort' ? 'cancelled' : 'failed'
		},
		states: {
			held: {
				on: {
					VALID: { target: 'settled', context: { result: 'replied' } },
					INVALID: { target: 'settled', context: { result: 'failed' } },
					ERROR: { target: 'settled', context: { result: 'failed' } },
					MESSAGE_ERROR: { target: 'settled', context: { result: 'failed' } },
					ABORT: { target: 'settled', context: { result: 'cancelled' } },
					CANCEL: { target: 'settled', context: { result: 'cancelled' } },
					STOP: { target: 'stopped', context: { result: 'stopped' } }
				}
			},
			settled: {
				on: {
					VALID: {},
					INVALID: {},
					ERROR: {},
					MESSAGE_ERROR: {},
					ABORT: {},
					CANCEL: {},
					STOP: {}
				}
			},
			stopped: {
				on: {
					VALID: {},
					INVALID: {},
					ERROR: {},
					MESSAGE_ERROR: {},
					ABORT: {},
					CANCEL: {},
					STOP: {}
				}
			}
		}
	})
}
it.each(['normal', 'pre-abort', 'construction', 'post'] as const)(
	'generates %s worker races against an independent single-outcome/resource ledger',
	async (scenario) => {
		const model = ledger(scenario)
		const sut: TestSut<SnapshotFrom<typeof model>, EventFrom<typeof model>> = {
			create: async () => {
				const worker = new TestJobWorker(),
					abort = new AbortController()
				let acquired = 0,
					opens = 0,
					outcomes = 0
				if (scenario === 'pre-abort') abort.abort()
				if (scenario === 'post')
					worker.postMessage.mockImplementation(() => {
						throw new Error('Refused')
					})
				const actor = createActor(job, {
					input: {
						signal: abort.signal,
						message: 'selected',
						decode: (value) => schema.parse(value),
						open: () => {
							opens++
							if (scenario === 'construction') throw new Error('Unavailable')
							acquired++
							return worker
						}
					}
				})
				actor.subscribe({
					next: (snapshot) => {
						if (snapshot.status === 'done') outcomes++
					}
				})
				actor.start()
				const message = worker.onmessage,
					error = worker.onerror,
					messageError = worker.onmessageerror
				return {
					send: (event) => {
						if (event.type === 'VALID')
							message?.(new MessageEvent('message', { data: { value: 7 } }))
						if (event.type === 'INVALID')
							message?.(new MessageEvent('message', { data: { value: 'bad' } }))
						if (event.type === 'ERROR') error?.()
						if (event.type === 'MESSAGE_ERROR') messageError?.()
						if (event.type === 'ABORT') abort.abort()
						if (event.type === 'CANCEL' && actor.getSnapshot().status === 'active')
							actor.send(event)
						if (event.type === 'STOP') actor.stop()
					},
					read: () => ({
						result:
							actor.getSnapshot().status === 'stopped'
								? 'stopped'
								: (actor.getSnapshot().output?.kind ?? 'pending'),
						opens,
						acquired,
						posts: worker.postMessage.mock.calls.length,
						terminations: worker.terminate.mock.calls.length,
						outcomes
					}),
					dispose: () => {
						actor.stop()
					}
				}
			},
			projectModel: (snapshot) => ({
				result: snapshot.context.result,
				opens: scenario === 'pre-abort' ? 0 : 1,
				acquired: scenario === 'pre-abort' || scenario === 'construction' ? 0 : 1,
				posts: scenario === 'pre-abort' || scenario === 'construction' ? 0 : 1,
				terminations:
					scenario === 'pre-abort' || scenario === 'construction' || snapshot.matches('held')
						? 0
						: 1,
				outcomes: snapshot.matches('settled') ? 1 : 0
			})
		}
		const { coverage } = await propertyTest(model, {
			seed: 20261119,
			numRuns: 120,
			maxCommands: 12,
			events: {
				VALID: fc.constant({}),
				INVALID: fc.constant({}),
				ERROR: fc.constant({}),
				MESSAGE_ERROR: fc.constant({}),
				ABORT: fc.constant({}),
				CANCEL: fc.constant({}),
				STOP: fc.constant({})
			},
			sut,
			failures: { dir: '.xstate-test', key: 'clipper-browser-job-' + scenario }
		})
		assertTestCoverage(coverage, { stateNodes: 1, eventTypes: 1, transitions: 1 })
	}
)
