import { it, expect, vi } from 'vitest'
import { createActor, toPromise, SimulatedClock } from 'xstate'
import { createProcessMachine } from './process-machine.js'
import type { ProcessEvent } from './process-machine.js'
function fixture(options: { throwOnOpen?: boolean; throwOnSignal?: boolean } = {}) {
	let report: ((event: ProcessEvent) => void) | undefined
	const signal = vi.fn(() => {
		if (options.throwOnSignal) throw new Error('signal failure')
	})
	const release = vi.fn()
	const clock = new SimulatedClock()
	const actor = createActor(
		createProcessMachine((_input, next) => {
			if (options.throwOnOpen) throw new Error('spawn failure')
			report = next
			return { signal, release }
		}),
		{ clock, input: { command: 'build', env: { SECRET: 'fixture-secret' } } }
	).start()
	return { actor, clock, signal, release, emit: (event: ProcessEvent) => report?.(event) }
}
it('escalates once after the modeled grace period and waits for physical close', async () => {
	const f = fixture()
	f.actor.send({ type: 'CANCEL' })
	f.actor.send({ type: 'CANCEL' })
	expect(f.signal.mock.calls).toEqual([['SIGTERM']])
	expect(f.release).not.toHaveBeenCalled()
	f.clock.increment(4999)
	expect(f.signal).toHaveBeenCalledTimes(1)
	f.clock.increment(1)
	expect(f.signal.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']])
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.release).not.toHaveBeenCalled()
	f.emit({ type: 'CLOSE', code: null })
	expect((await toPromise(f.actor)).outcome).toBe('cancelled')
	expect(f.release).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().context.input).toBeUndefined()
})
it('cancels the escalation timer when a terminated process closes promptly', async () => {
	const f = fixture()
	f.actor.send({ type: 'CANCEL' })
	f.emit({ type: 'CLOSE', code: 0 })
	expect((await toPromise(f.actor)).outcome).toBe('cancelled')
	f.clock.increment(10000)
	expect(f.signal).toHaveBeenCalledOnce()
})
it('retains an errored process until close instead of releasing its owner early', async () => {
	const f = fixture()
	f.emit({ type: 'ERROR' })
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.release).not.toHaveBeenCalled()
	f.emit({ type: 'CLOSE', code: 1 })
	expect(await toPromise(f.actor)).toMatchObject({ outcome: 'failed', startFailed: true })
	expect(f.release).toHaveBeenCalledOnce()
})
it('settles synchronous spawn failure without retaining environment secrets', async () => {
	const f = fixture({ throwOnOpen: true })
	expect(await toPromise(f.actor)).toMatchObject({ outcome: 'failed', startFailed: true })
	expect(f.actor.getSnapshot().context.input).toBeUndefined()
})
it('reports only the bounded HTTP status on nonzero close', async () => {
	const f = fixture()
	f.emit({ type: 'CLOSE', code: 1, httpStatus: '403' })
	expect(await toPromise(f.actor)).toEqual({
		outcome: 'failed',
		code: 1,
		startFailed: false,
		httpStatus: '403'
	})
})
it('signal failure does not falsely complete cancellation while a process remains alive', async () => {
	const f = fixture({ throwOnSignal: true })
	f.actor.send({ type: 'CANCEL' })
	f.clock.increment(5000)
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.release).not.toHaveBeenCalled()
	f.emit({ type: 'CLOSE', code: 1 })
	expect((await toPromise(f.actor)).outcome).toBe('cancelled')
})
