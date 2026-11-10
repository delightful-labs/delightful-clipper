import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { z } from 'zod'
import { createBrowserWorkerJob } from './browser-worker-job.js'
import { TestJobWorker } from './browser-worker-job.test-support.js'

const reply = z.object({ value: z.number().int() })
const machine = createBrowserWorkerJob<string, z.infer<typeof reply>>()
function fixture(options: { signal?: AbortSignal; failOpen?: boolean; failPost?: boolean } = {}) {
	const worker = new TestJobWorker()
	if (options.failPost)
		worker.postMessage.mockImplementation(() => {
			throw new Error('Refused')
		})
	const open = vi.fn(() => {
		if (options.failOpen) throw new Error('Unavailable')
		return worker
	})
	const actor = createActor(machine, {
		input: {
			open,
			decode: (value) => reply.parse(value),
			message: 'selected',
			...(options.signal ? { signal: options.signal } : {})
		}
	})
	return { actor, worker, open }
}
it('delivers validated replies only after synchronous native cleanup, once', async () => {
	const f = fixture(),
		outcomes: unknown[] = []
	f.actor.subscribe({
		complete: () => {
			expect(f.worker.terminate).toHaveBeenCalledOnce()
			outcomes.push(f.actor.getSnapshot().output)
		}
	})
	f.actor.start()
	const late = f.worker.onmessage
	f.worker.reply({ value: 7 })
	f.worker.reply({ value: 8 })
	late?.(new MessageEvent('message', { data: { value: 9 } }))
	f.actor.send({ type: 'CANCEL' })
	expect(await toPromise(f.actor)).toMatchObject({ kind: 'replied', reply: { value: 7 } })
	expect(outcomes).toHaveLength(1)
	expect(f.worker.onmessage).toBeNull()
	expect(f.worker.onerror).toBeNull()
	expect(f.worker.onmessageerror).toBeNull()
	expect(f.worker.postMessage).toHaveBeenCalledExactlyOnceWith('selected', [])
})
it.each(['construction', 'post', 'worker', 'message', 'reply'] as const)(
	'contains %s failure and releases each acquired worker',
	async (reason) => {
		const f = fixture({ failOpen: reason === 'construction', failPost: reason === 'post' })
		f.actor.start()
		if (reason === 'worker') f.worker.onerror?.(new Event('error'))
		if (reason === 'message') f.worker.onmessageerror?.(new Event('messageerror'))
		if (reason === 'reply') f.worker.reply({ value: 'invalid' })
		expect(await toPromise(f.actor)).toMatchObject({ kind: 'failed', reason })
		expect(f.worker.terminate).toHaveBeenCalledTimes(reason === 'construction' ? 0 : 1)
	}
)
it('refuses pre-aborted admission before construction/posting and removes its listener', async () => {
	const abort = new AbortController()
	abort.abort()
	const remove = vi.spyOn(abort.signal, 'removeEventListener'),
		f = fixture({ signal: abort.signal })
	f.actor.start()
	expect(await toPromise(f.actor)).toMatchObject({ kind: 'cancelled' })
	expect(f.open).not.toHaveBeenCalled()
	expect(f.worker.postMessage).not.toHaveBeenCalled()
	expect(f.worker.terminate).not.toHaveBeenCalled()
	expect(remove).toHaveBeenCalledOnce()
})
it.each(['signal', 'command', 'stop'] as const)(
	'cleans up on %s without accepting a late reply',
	async (mode) => {
		const abort = new AbortController(),
			f = fixture({ signal: abort.signal })
		f.actor.start()
		const late = f.worker.onmessage
		if (mode === 'signal') abort.abort()
		if (mode === 'command') f.actor.send({ type: 'CANCEL' })
		if (mode === 'stop') f.actor.stop()
		late?.(new MessageEvent('message', { data: { value: 7 } }))
		if (mode !== 'stop') expect(await toPromise(f.actor)).toMatchObject({ kind: 'cancelled' })
		else expect(f.actor.getSnapshot().output).toBeUndefined()
		expect(f.worker.terminate).toHaveBeenCalledOnce()
	}
)
it('does not acknowledge settlement when native termination refuses cleanup', () => {
	const f = fixture()
	f.worker.terminate.mockImplementation(() => {
		throw new Error('Termination unavailable')
	})
	f.actor.start()
	f.worker.reply({ value: 7 })
	expect(f.actor.getSnapshot().matches('blocked')).toBe(true)
	expect(f.actor.getSnapshot().output).toBeUndefined()
	f.actor.send({ type: 'CANCEL' })
	f.actor.stop()
	expect(f.worker.terminate).toHaveBeenCalledOnce()
})

it('handles abort during native construction before posting and still terminates the returned worker', async () => {
	const abort = new AbortController(),
		worker = new TestJobWorker()
	const actor = createActor(machine, {
		input: {
			signal: abort.signal,
			message: 'selected',
			decode: (value) => reply.parse(value),
			open: () => {
				abort.abort()
				return worker
			}
		}
	}).start()
	expect(await toPromise(actor)).toMatchObject({ kind: 'cancelled' })
	expect(worker.postMessage).not.toHaveBeenCalled()
	expect(worker.terminate).toHaveBeenCalledOnce()
})

it('retains the first reentrant reply/error/abort outcome through cleanup', async () => {
	const abort = new AbortController(),
		f = fixture({ signal: abort.signal })
	f.worker.postMessage.mockImplementation(() => {
		f.worker.reply({ value: 7 })
		f.worker.onerror?.()
		abort.abort()
	})
	f.actor.start()
	expect(await toPromise(f.actor)).toMatchObject({ kind: 'replied', reply: { value: 7 } })
	expect(f.worker.terminate).toHaveBeenCalledOnce()
})
