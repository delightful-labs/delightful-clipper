import { it, expect, vi } from 'vitest'
import { createActor, toPromise, SimulatedClock } from 'xstate'
import { createProcessMachine } from './process-machine.js'
import type { ProcessEvent } from './process-machine.js'
function fixture(
	options: {
		throwOnOpen?: boolean
		throwOnSignal?: boolean
		throwOnRelease?: boolean
		throwOnProbe?: boolean
		pausedSpawn?: boolean
	} = {}
) {
	let report: ((event: ProcessEvent) => void) | undefined
	let alive = true
	const signal = vi.fn(() => {
		if (options.throwOnSignal) throw new Error('signal failure')
	})
	const release = vi.fn(() => {
		if (options.throwOnRelease) throw new Error('release failure')
	})
	const clock = new SimulatedClock()
	const actor = createActor(
		createProcessMachine((_input, next) => {
			if (options.throwOnOpen) throw new Error('spawn failure')
			report = next
			return {
				signal,
				release,
				isAlive: () => {
					if (options.throwOnProbe) throw new Error('scope check failed')
					return alive
				}
			}
		}),
		{ clock, input: { command: 'build', env: { SECRET: 'fixture-secret' } } }
	).start()
	if (!options.pausedSpawn) report?.({ type: 'SPAWNED' })
	return {
		actor,
		clock,
		signal,
		release,
		emit: (event: ProcessEvent) => report?.(event),
		gone: () => {
			alive = false
		},
		close: (code: number | null) => {
			alive = false
			report?.({ type: 'CLOSE', code })
		}
	}
}
it('escalates once after the grace period and waits for close and the process scope to disappear', async () => {
	const f = fixture()
	f.actor.send({ type: 'CANCEL' })
	f.actor.send({ type: 'CANCEL' })
	expect(f.signal.mock.calls).toEqual([['SIGTERM']])
	f.clock.increment(4999)
	expect(f.signal).toHaveBeenCalledOnce()
	f.clock.increment(1)
	expect(f.signal.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']])
	expect(f.release).not.toHaveBeenCalled()
	f.close(null)
	expect((await toPromise(f.actor)).outcome).toBe('cancelled')
	expect(f.release).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().context).toMatchObject({
		input: undefined,
		diagnostic: '',
		close: undefined
	})
})
it('cancels escalation only after close and scope disappearance', async () => {
	const f = fixture()
	f.actor.send({ type: 'CANCEL' })
	f.close(0)
	expect((await toPromise(f.actor)).outcome).toBe('cancelled')
	f.clock.increment(10000)
	expect(f.signal).toHaveBeenCalledOnce()
})
it('retains escalation when the direct child closes before its descendants', async () => {
	const f = fixture()
	f.actor.send({ type: 'CANCEL' })
	f.clock.increment(2000)
	f.emit({ type: 'CLOSE', code: 0 })
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.release).not.toHaveBeenCalled()
	f.clock.increment(3000)
	expect(f.signal.mock.calls).toEqual([['SIGTERM'], ['SIGKILL']])
	f.gone()
	f.clock.increment(100)
	expect((await toPromise(f.actor)).outcome).toBe('cancelled')
})
it('cleans up descendants after ordinary child completion too', async () => {
	const f = fixture()
	f.emit({ type: 'CLOSE', code: 0 })
	expect(f.signal.mock.calls).toEqual([['SIGTERM']])
	expect(f.release).not.toHaveBeenCalled()
	f.gone()
	f.clock.increment(100)
	expect((await toPromise(f.actor)).outcome).toBe('succeeded')
})
it('waits for native close when the scope disappears before stdio closes', async () => {
	const f = fixture()
	f.gone()
	f.actor.send({ type: 'CANCEL' })
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.release).not.toHaveBeenCalled()
	f.emit({ type: 'CLOSE', code: null })
	expect((await toPromise(f.actor)).outcome).toBe('cancelled')
})
it('defers cancellation signaling until spawn confirmation', async () => {
	const f = fixture({ pausedSpawn: true })
	f.actor.send({ type: 'CANCEL' })
	expect(f.signal).not.toHaveBeenCalled()
	f.emit({ type: 'SPAWNED' })
	expect(f.signal.mock.calls).toEqual([['SIGTERM']])
	f.close(null)
	expect((await toPromise(f.actor)).outcome).toBe('cancelled')
})
it('distinguishes asynchronous spawn failure and drains close', async () => {
	const f = fixture({ pausedSpawn: true })
	f.emit({ type: 'PROCESS_ERROR' })
	expect(f.actor.getSnapshot().status).toBe('active')
	f.close(-2)
	expect(await toPromise(f.actor)).toMatchObject({
		outcome: 'failed',
		startFailed: true,
		signalFailed: false
	})
})
it('classifies an error after spawn as a runtime failure', async () => {
	const f = fixture()
	f.emit({ type: 'PROCESS_ERROR' })
	f.close(0)
	expect(await toPromise(f.actor)).toMatchObject({ outcome: 'failed', startFailed: false })
})
it('settles synchronous spawn failure without retaining environment secrets', async () => {
	const f = fixture({ throwOnOpen: true })
	expect(await toPromise(f.actor)).toMatchObject({ outcome: 'failed', startFailed: true })
	expect(f.actor.getSnapshot().context.input).toBeUndefined()
})
it('keeps diagnostics bounded, returns only an allowlisted status and clears raw stderr', async () => {
	const f = fixture()
	f.emit({ type: 'STDERR', text: 'private'.repeat(5000) })
	expect(f.actor.getSnapshot().context.diagnostic.length).toBe(16384)
	f.emit({ type: 'STDERR', text: 'Schema pub' })
	f.emit({ type: 'STDERR', text: 'lish failed: 403 secret=fixture-secret' })
	f.close(1)
	expect(await toPromise(f.actor)).toEqual({
		outcome: 'failed',
		code: 1,
		startFailed: false,
		signalFailed: false,
		cleanupFailed: false,
		httpStatus: '403'
	})
	expect(f.actor.getSnapshot().context.diagnostic).toBe('')
})
it('records signal failure without misreporting spawn failure or completing early', async () => {
	const f = fixture({ throwOnSignal: true })
	f.actor.send({ type: 'CANCEL' })
	f.clock.increment(5000)
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.release).not.toHaveBeenCalled()
	f.close(1)
	expect(await toPromise(f.actor)).toMatchObject({
		outcome: 'cancelled',
		startFailed: false,
		signalFailed: true
	})
})
it('reports explicit release failure separately from spawn failure', async () => {
	const f = fixture({ throwOnRelease: true })
	f.close(0)
	expect(await toPromise(f.actor)).toMatchObject({
		outcome: 'failed',
		startFailed: false,
		cleanupFailed: true
	})
})
it('requests unconditional emergency termination on forced actor stop', () => {
	const f = fixture()
	f.actor.stop()
	f.actor.stop()
	expect(f.signal.mock.calls).toEqual([['SIGKILL']])
	expect(f.release).toHaveBeenCalledOnce()
})

it('does not release on a failed scope probe and reports cleanup failure after recovery', async () => {
	const options = { throwOnProbe: true }
	const f = fixture(options)
	f.emit({ type: 'CLOSE', code: 0 })
	expect(f.release).not.toHaveBeenCalled()
	expect(f.actor.getSnapshot().status).toBe('active')
	f.clock.increment(5000)
	options.throwOnProbe = false
	f.gone()
	f.clock.increment(100)
	expect(await toPromise(f.actor)).toMatchObject({
		outcome: 'failed',
		startFailed: false,
		cleanupFailed: true
	})
})
