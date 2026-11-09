import { expect, it } from 'vitest'
import * as fc from 'fast-check'
import { assertTestCoverage, propertyTest, type TestSut } from '@xstate/test'
import { createActor, setup, types, waitFor, type EventFrom, type SnapshotFrom } from 'xstate'
import type { LibraryCapability } from '../../contracts/library.js'
import { libraryMachine } from '../../machines/capture/library.js'
import { createWorkerHostFixture } from './host-machine.test-support.js'

// Independent integration contract: an admitted binding replaces the UI scope,
// resets pagination and owns one tag editor. Probes and stale intents change none
// of those facts. The real worker host and its real children are the SUT.
type Slot = 'none' | 'A' | 'B'
const contract = setup({
	schemas: {
		context: types<{
			slot: Slot
			scope: string
			limit: number
			history: Slot[]
			rebound: boolean
		}>(),
		events: {
			BIND: types<{ slot: Slot; scope: string }>(),
			PROBE: types<{ slot: Slot; scope: string }>(),
			MORE: types(),
			STALE_MORE: types()
		}
	}
}).createMachine({
	id: 'worker-binding-contract',
	initial: 'unbound',
	context: { slot: 'none', scope: 'test-scope', limit: 50, history: [], rebound: false },
	on: {
		BIND: ({ context, event }) => {
			const history = [...context.history, event.slot].slice(-3)
			return {
				target: event.slot === 'none' ? '.unbound' : '.bound',
				context: {
					slot: event.slot,
					scope: event.scope,
					limit: 50,
					history,
					rebound: context.rebound || history.join(',') === 'A,B,A'
				}
			}
		}
	},
	states: {
		unbound: {
			on: {
				PROBE: { target: 'unbound' },
				MORE: { target: 'unbound' },
				STALE_MORE: { target: 'unbound' }
			}
		},
		bound: {
			on: {
				PROBE: { target: 'bound' },
				MORE: ({ context }) => ({ context: { limit: context.limit + 50 } }),
				STALE_MORE: { target: 'bound' }
			}
		}
	}
})

function capability(id: string): LibraryCapability {
	return {
		libraryId: id,
		isCurrent: () => true,
		spawnSave: () => {
			throw new Error('Binding qualification must not issue writes')
		},
		read: {
			isCurrent: () => true,
			document: async () => null,
			snapshot: async () => null,
			asset: async () => null,
			source: async () => null
		},
		subscribe: () => () => {},
		worker: (report) => ({
			send: (event) => {
				if (event.type === 'STOP') report({ type: 'BACKGROUND_CLOSED' })
			},
			stop: async () => {}
		})
	}
}

const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	create: () => {
		const f = createWorkerHostFixture()
		const libraries = {
			A: createActor(libraryMachine, { input: capability('A') }).start(),
			B: createActor(libraryMachine, { input: capability('B') }).start()
		}
		const editors = new Set<
			NonNullable<ReturnType<typeof f.actor.getSnapshot>['context']['tagForm']>
		>()
		f.actor.start()
		return {
			send(event) {
				if (event.type === 'BIND' || event.type === 'PROBE') {
					const command = {
						type: 'BIND_LIBRARY' as const,
						library: event.slot === 'none' ? undefined : libraries[event.slot],
						scope: event.scope
					}
					if (event.type === 'PROBE') {
						const before = f.actor.getSnapshot()
						before.can(command)
						before.can(command)
						expect(f.actor.getSnapshot()).toBe(before)
					} else {
						f.actor.send(command)
						const editor = f.actor.getSnapshot().context.tagForm
						if (editor) editors.add(editor)
					}
				} else {
					const scope = f.actor.getSnapshot().context.scope
					f.actor.send({ type: 'MORE', scope: event.type === 'MORE' ? scope : scope + ':obsolete' })
				}
			},
			read() {
				const snapshot = f.actor.getSnapshot(),
					context = snapshot.context
				return {
					slot:
						context.library === libraries.A ? 'A' : context.library === libraries.B ? 'B' : 'none',
					scope: context.scope,
					limit: context.limit,
					activeEditors: [...editors].filter((editor) => editor.getSnapshot().status === 'active')
						.length,
					accepting: snapshot.matches({ running: 'accepting' })
				}
			},
			async dispose() {
				try {
					f.actor.send({ type: 'SHUTDOWN' })
					await waitFor(
						f.actor,
						(snapshot) => snapshot.status === 'done' || snapshot.matches('failed'),
						{ timeout: 1000 }
					)
					expect(f.actor.getSnapshot().value).toBe('closed')
					expect([...editors].every((editor) => editor.getSnapshot().status !== 'active')).toBe(
						true
					)
					expect(f.close).toHaveBeenCalledOnce()
				} finally {
					f.actor.stop()
					f.owner.stop()
					libraries.A.stop()
					libraries.B.stop()
				}
			}
		}
	},
	projectModel: ({ context }) => ({
		slot: context.slot,
		scope: context.scope,
		limit: context.limit,
		activeEditors: context.slot === 'none' ? 0 : 1,
		accepting: true
	})
}

it('generates binding replacements, A → B → A, pure probes and stale worker intents', async () => {
	const binding = fc.record({ slot: fc.constantFrom<Slot>('none', 'A', 'B'), scope: fc.uuid() })
	const { coverage } = await propertyTest(contract, {
		seed: 60381,
		numRuns: 100,
		maxCommands: 60,
		failures: { dir: '.xstate-test', key: 'clipper-worker-bindings' },
		temporal: [
			{
				type: 'sometimes',
				id: 'A-B-A-rebinding',
				predicate: ({ snapshot }) => snapshot.context.rebound
			}
		],
		events: { BIND: binding, PROBE: binding, MORE: fc.constant({}), STALE_MORE: fc.constant({}) },
		sut
	})
	assertTestCoverage(coverage, { stateNodes: 1, eventTypes: 1, transitions: 1 })
})
