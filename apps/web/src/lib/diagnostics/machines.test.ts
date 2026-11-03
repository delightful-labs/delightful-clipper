import { it, expect, vi } from 'vitest'
import { createActor, createMachine, fromPromise, waitFor, toPromise } from 'xstate'
import { createLogger } from 'delightful-local-first/diagnostics/logger'
import { createMachineObserver } from './machines.js'

function fixture(enabled = true) {
	const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
	const inspect = createMachineObserver(createLogger('test', { enabled, sink }), enabled)
	return { sink, inspect }
}
it('logs a caught child error and modeled failure without copying input, context or error payloads', async () => {
	const { sink, inspect } = fixture()
	const error = Object.assign(
		new Error('Protocol: durable catalogue must have exactly one genesis schema'),
		{ payload: 'private-error-payload' }
	)
	const actor = createActor(
		createMachine({
			id: 'bootstrap-fixture',
			context: { phrase: 'private-recovery-phrase', url: 'https://private.example/article' },
			initial: 'reading',
			states: {
				reading: {
					invoke: {
						src: fromPromise(async () => {
							throw error
						}),
						onError: 'failed'
					}
				},
				failed: { type: 'final' }
			}
		}),
		{ inspect }
	).start()
	await waitFor(actor, (s) => s.status === 'done')
	expect(sink.error).toHaveBeenCalled()
	const logs = JSON.stringify(sink.error.mock.calls)
	expect(logs).toContain('durable catalogue must have exactly one genesis schema')
	expect(logs).toContain('bootstrap-fixture')
	expect(logs).not.toMatch(/private-recovery|private\.example|private-error-payload/)
})
it('sanitizes credentials and source data embedded in error messages', async () => {
	const { sink, inspect } = fixture()
	const actor = createActor(
		fromPromise(async () => {
			throw new Error(
				'Failed Bearer secret-credential at https://private.example/a?token=hidden with {"text":"private-content"}'
			)
		}),
		{ inspect }
	)
	const settled = toPromise(actor).catch(() => undefined)
	actor.start()
	await settled
	const logs = JSON.stringify(sink.error.mock.calls)
	expect(logs).toContain('Machine failure')
	expect(logs).not.toMatch(/secret-credential|private\.example|hidden|private-content/)
})
it('does not emit state or failure diagnostics when disabled', async () => {
	const { sink, inspect } = fixture(false)
	const actor = createActor(
		createMachine({ id: 'fixture', initial: 'failed', states: { failed: { type: 'final' } } }),
		{ inspect }
	).start()
	await waitFor(actor, (s) => s.status === 'done')
	expect(sink.error).not.toHaveBeenCalled()
	expect(sink.info).not.toHaveBeenCalled()
	expect(sink.warn).not.toHaveBeenCalled()
})
it('reports only modeled state and outcome from a completed save', async () => {
	const { sink, inspect } = fixture()
	const actor = createActor(
		createMachine({
			id: 'save-fixture',
			context: { text: 'private-content' },
			initial: 'done',
			states: { done: { type: 'final' } },
			output: { kind: 'unknown', article: 'private-content' }
		}),
		{ inspect }
	).start()
	await waitFor(actor, (s) => s.status === 'done')
	expect(JSON.stringify(sink.error.mock.calls)).toContain('unknown')
	expect(JSON.stringify(sink.error.mock.calls)).not.toContain('private-content')
})
