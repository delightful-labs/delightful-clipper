import { it, expect, vi } from 'vitest'
import {
	createActor,
	createMachine,
	waitFor,
	toPromise,
	createAsyncLogic,
	setup,
	types
} from 'xstate'
import { createLogger } from 'delightful-local-first/diagnostics/logger'
import { createMachineObserver, createRejectedEventObserver } from './machines.js'

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
						src: createAsyncLogic({
							run: async () => {
								throw error
							}
						}),
						onError: { target: 'failed' }
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
		createAsyncLogic({
			run: async () => {
				throw new Error(
					'Failed Bearer secret-credential at https://private.example/a?token=hidden with {"text":"private-content"}'
				)
			}
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

it('observes missing required recipients without exposing rejected payloads, dynamic IDs or errors', () => {
	const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
	const logger = createLogger('test', { enabled: true, sink })
	const actor = createActor(
		createMachine({
			id: 'rejection-fixture',
			entry: ({ parent }, enq) => {
				enq.sendTo(parent, {
					type: 'CLOSED',
					phrase: 'private recovery phrase',
					token: 'private-credential',
					source: 'https://private.example/'
				})
			}
		}),
		{ onRejectedEvent: createRejectedEventObserver(logger, true) }
	).start()
	const logs = JSON.stringify(sink.warn.mock.calls)
	expect(logs).toContain('Machine event rejected')
	expect(logs).toContain('missingTarget')
	expect(logs).toContain('CLOSED')
	expect(logs).not.toMatch(/private|credential|phrase|https/)
	actor.stop()
})
it('observes forbidden private delivery and disables rejected-event diagnostics without changing state', () => {
	const sink = { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
		logger = createLogger('test', { enabled: true, sink })
	const logic = setup({
		schemas: { events: { START: types() }, internalEvents: { STAGED: types() } }
	}).createMachine({
		initial: 'waiting',
		states: { waiting: { on: { STAGED: { target: 'done' } } }, done: { type: 'final' } }
	})
	for (const enabled of [true, false]) {
		const actor = createActor(logic, {
			onRejectedEvent: createRejectedEventObserver(logger, enabled)
		}).start()
		Reflect.apply(actor.send, actor, [{ type: 'STAGED', token: 'private-credential' }])
		expect(actor.getSnapshot().matches('waiting')).toBe(true)
		actor.stop()
	}
	expect(sink.warn).toHaveBeenCalledOnce()
	expect(JSON.stringify(sink.warn.mock.calls)).toContain('internalEvent')
	expect(JSON.stringify(sink.warn.mock.calls)).not.toContain('private-credential')
})
