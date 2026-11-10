import { expect, it } from 'vitest'
import * as fc from 'fast-check'
import { propertyTest, assertTestCoverage, type TestSut } from '@xstate/test'
import { createActor, setup, types, waitFor, type EventFrom, type SnapshotFrom } from 'xstate'
import { libraryMachine } from './library.js'
import { controlledSave, testLibraryCapability } from './library.test-support.js'
import type { ArticleSaveResult } from '../../contracts/articles.js'

// Independent obligation model: one issued write must settle before shutdown
// completes. Late or duplicate completion cannot issue another write or change
// an uncertain result into a successful one.
const contract = setup({
	schemas: {
		context: types<{
			issued: number
			outcome: 'none' | 'saved' | 'unknown'
			duplicatedUnknown: boolean
		}>(),
		events: {
			SHUTDOWN: types(),
			COMPLETE: types<{ kind: 'saved' | 'unknown' }>(),
			DUPLICATE: types()
		}
	}
}).createMachine({
	context: { issued: 1, outcome: 'none', duplicatedUnknown: false },
	initial: 'pending',
	states: {
		pending: {
			on: {
				SHUTDOWN: { target: 'draining' },
				COMPLETE: ({ event }) => ({ target: 'settled', context: { outcome: event.kind } })
			}
		},
		draining: { on: { SHUTDOWN: {}, COMPLETE: { target: 'closed' } } },
		settled: {
			on: {
				SHUTDOWN: { target: 'closed' },
				COMPLETE: {},
				DUPLICATE: ({ context }) => ({
					context: { duplicatedUnknown: context.duplicatedUnknown || context.outcome === 'unknown' }
				})
			}
		},
		closed: { on: { SHUTDOWN: {}, COMPLETE: {}, DUPLICATE: {} } }
	}
})
const operationId = '77777777-7777-4777-8777-777777777777'
const candidate = {
	id: operationId,
	title: 'Article',
	submittedUrl: 'https://example.com/',
	finalUrl: 'https://example.com/',
	text: '',
	html: '',
	provenance: '{}',
	imagesMissing: false
}
const sut: TestSut<SnapshotFrom<typeof contract>, EventFrom<typeof contract>> = {
	create: async () => {
		const completion = Promise.withResolvers<ArticleSaveResult>()
		let issued = 0,
			childId = '',
			completed = false
		const save = controlledSave(async () => {
			issued++
			return completion.promise
		})
		const actor = createActor(libraryMachine, {
			input: testLibraryCapability(candidate, {
				spawnSave: (spawn, input) => {
					const child = spawn(save, { input })
					childId = child.id
					return child
				}
			})
		}).start()
		actor.send({ type: 'ADD', url: candidate.submittedUrl })
		await waitFor(actor, (snapshot) => !!snapshot.context.saveRef)
		return {
			async send(event) {
				if (actor.getSnapshot().status === 'done') return
				if (event.type === 'SHUTDOWN') actor.send(event)
				else if (event.type === 'COMPLETE') {
					completed = true
					completion.resolve(
						event.kind === 'saved'
							? { kind: 'saved', operationId, receipts: [] }
							: { kind: 'unknown', operationId }
					)
					await waitFor(actor, (snapshot) => !snapshot.matches({ running: { capture: 'saving' } }))
				} else if (completed) {
					actor.send({
						type: 'WRITE_DONE',
						actorId: childId,
						output: { kind: 'saved', operationId, receipts: [] }
					})
				}
			},
			read: () => {
				const snapshot = actor.getSnapshot()
				return {
					issued,
					closed: snapshot.status === 'done',
					outcome: snapshot.matches({ running: { capture: 'uncertain' } })
						? 'unknown'
						: snapshot.matches({ running: { capture: 'saved' } })
							? 'saved'
							: 'none'
				}
			},
			async dispose() {
				if (actor.getSnapshot().status !== 'done') actor.send({ type: 'SHUTDOWN' })
				completion.resolve({ kind: 'unknown', operationId })
				await waitFor(actor, (snapshot) => snapshot.status === 'done')
				expect(issued).toBeLessThanOrEqual(1)
				actor.stop()
			}
		}
	},
	projectModel: (snapshot) => ({
		issued: snapshot.context.issued,
		closed: snapshot.matches('closed'),
		outcome: snapshot.matches('settled') ? snapshot.context.outcome : 'none'
	})
}
it('generates issued-write drain, uncertain settlement and duplicate completion', async () => {
	const { coverage } = await propertyTest(contract, {
		seed: 60383,
		numRuns: 100,
		maxCommands: 20,
		events: {
			SHUTDOWN: fc.constant({}),
			COMPLETE: fc.record({ kind: fc.constantFrom('saved', 'unknown') }),
			DUPLICATE: fc.constant({})
		},
		sut,
		failures: { dir: '.xstate-test', key: 'clipper-library-drain' },
		temporal: [
			{
				type: 'sometimes',
				id: 'uncertain-result',
				predicate: ({ snapshot }) => snapshot.context.outcome === 'unknown'
			},
			{
				type: 'sometimes',
				id: 'duplicate-after-uncertain-result',
				predicate: ({ snapshot }) => snapshot.context.duplicatedUnknown
			}
		]
	})
	assertTestCoverage(coverage, { stateNodes: 1, eventTypes: 1, transitions: 1 })
})
