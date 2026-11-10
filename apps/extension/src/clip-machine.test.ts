import { TestJobWorker } from '../../web/src/lib/machines/browser-worker-job.test-support.js'
import { extractionJob } from './worker.js'
import type { ClipCapability } from './clip-machine.js'
import { promiseWorkerJob } from '../../web/src/lib/machines/browser-worker-job.test-support.js'
import { extractionReplySchema } from './protocol.js'
import { expect, it, vi } from 'vitest'
import { createActor, waitFor, SimulatedClock } from 'xstate'
import { createClipMachine } from './clip-machine.js'
import { libraryMachine } from '../../web/src/lib/machines/capture/library.js'
import {
	controlledSave,
	testLibraryCapability
} from '../../web/src/lib/machines/capture/library.test-support.js'
import type { ArticleSaveResult } from '../../web/src/lib/contracts/articles.js'
const id = '77777777-7777-4777-8777-777777777777'
const capture = {
	version: 1 as const,
	id,
	tabId: 7,
	documentId: 'document',
	url: 'https://example.com/article',
	phase: 'ready' as const
}
const content = {
	title: 'Rendered article',
	text: 'Rendered article text',
	html: '<p>Rendered article text</p>',
	finalUrl: capture.url,
	provenance: '{}'
}
const source = { url: capture.url, base: capture.url, html: '<html>article</html>' }
function fixture(
	options: {
		phase?: 'ready' | 'issued'
		write?: Promise<ArticleSaveResult>
		mark?: Promise<void>
		read?: Promise<unknown>
		extract?: (signal: AbortSignal) => Promise<unknown>
		job?: ClipCapability['extraction']
		now?: () => number
	} = {}
) {
	const shutdown = vi.fn()
	const work = vi.fn(
		async () =>
			options.write ?? { kind: 'saved' as const, operationId: id, ready: true, receipts: [] }
	)
	const save = controlledSave(work, shutdown)
	const candidate = { id, ...content, submittedUrl: capture.url, imagesMissing: false }
	const owner = createActor(libraryMachine, {
		input: testLibraryCapability(candidate, { spawnSave: (spawn, input) => spawn(save, { input }) })
	}).start()
	const issue = vi.fn(async () => options.mark)
	const remove = vi.fn(async () => {})
	const extract = vi.fn(async (_source: unknown, signal: AbortSignal) =>
		options.extract ? options.extract(signal) : content
	)
	const clock = new SimulatedClock()
	const actor = createActor(createClipMachine(), {
		clock,
		input: {
			id,
			capability: {
				library: owner,
				accountId: id,
				current: () => true,
				read: async () =>
					options.read ?? { capture: { ...capture, phase: options.phase ?? 'ready' }, source },
				issue,
				remove,
				extraction: (value) =>
					options.job?.(value) ??
					promiseWorkerJob(
						value,
						(reply) => extractionReplySchema.parse(reply),
						async (signal) => ({ content: await extract(value, signal) }),
						options.now ?? (() => clock.now())
					)
			}
		}
	}).start()
	return { actor, owner, work, shutdown, issue, remove, extract, clock }
}
it('supplies content through the common URL save operation after durable admission', async () => {
	const f = fixture()
	await waitFor(f.actor, (s) => s.matches('saved') || s.matches('unknown') || s.matches('closed'))
	expect(f.issue).toHaveBeenCalledOnce()
	expect(f.work).toHaveBeenCalledWith({ url: capture.url, content })
	expect(f.remove).toHaveBeenCalledWith(id)
	f.actor.send({ type: 'SHUTDOWN' })
	f.owner.send({ type: 'SHUTDOWN' })
})
it('never recaptures or saves an operation marked issued on reopening', async () => {
	const f = fixture({ phase: 'issued' })
	await waitFor(f.actor, (s) => s.matches('saved') || s.matches('unknown') || s.matches('closed'))
	expect(f.actor.getSnapshot().matches('unknown')).toBe(true)
	expect(f.extract).not.toHaveBeenCalled()
	expect(f.issue).not.toHaveBeenCalled()
	expect(f.work).not.toHaveBeenCalled()
	f.actor.send({ type: 'SHUTDOWN' })
	f.owner.send({ type: 'SHUTDOWN' })
})
it('drains the issued marker without starting a native save after shutdown', async () => {
	const gate = Promise.withResolvers<void>()
	const f = fixture({ mark: gate.promise })
	await vi.waitFor(() => expect(f.issue).toHaveBeenCalledOnce())
	f.actor.send({ type: 'SHUTDOWN' })
	expect(f.actor.getSnapshot().status).toBe('active')
	gate.resolve()
	await waitFor(f.actor, (s) => s.matches('saved') || s.matches('unknown') || s.matches('closed'))
	expect(f.work).not.toHaveBeenCalled()
	f.actor.send({ type: 'SHUTDOWN' })
	f.owner.send({ type: 'SHUTDOWN' })
})
it('drains native saving on repeated shutdown without clearing an uncertain capture', async () => {
	const gate = Promise.withResolvers<ArticleSaveResult>()
	const f = fixture({ write: gate.promise })
	await vi.waitFor(() => expect(f.work).toHaveBeenCalledOnce())
	f.actor.send({ type: 'SHUTDOWN' })
	f.actor.send({ type: 'SHUTDOWN' })
	expect(f.shutdown).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().status).toBe('active')
	gate.resolve({ kind: 'unknown', operationId: id })
	await waitFor(f.actor, (s) => s.matches('saved') || s.matches('unknown') || s.matches('closed'))
	expect(f.actor.getSnapshot().matches('unknown')).toBe(true)
	expect(f.remove).not.toHaveBeenCalled()
	expect(f.actor.getSnapshot().context.content).toBeUndefined()
	f.actor.send({ type: 'SHUTDOWN' })
	f.owner.send({ type: 'SHUTDOWN' })
})
it('bounds a stalled extraction and saves the native URL article', async () => {
	let aborted: AbortSignal | undefined
	const f = fixture({
		extract: (signal) => {
			aborted = signal
			return new Promise(() => {})
		}
	})
	await vi.waitFor(() => expect(f.extract).toHaveBeenCalledOnce())
	f.clock.increment(15000)
	expect(aborted?.aborted).toBe(true)
	await waitFor(f.actor, (s) => s.matches('saved') || s.matches('unknown') || s.matches('closed'))
	expect(f.work).toHaveBeenCalledWith({ url: capture.url })
	f.actor.send({ type: 'SHUTDOWN' })
	f.owner.send({ type: 'SHUTDOWN' })
})

it('shutdown during extraction aborts the worker before any native write', async () => {
	let aborted: AbortSignal | undefined
	const f = fixture({
		extract: (signal) => {
			aborted = signal
			return new Promise(() => {})
		}
	})
	await vi.waitFor(() => expect(f.extract).toHaveBeenCalledOnce())
	f.actor.send({ type: 'SHUTDOWN' })
	await waitFor(f.actor, (s) => s.status === 'done')
	expect(aborted?.aborted).toBe(true)
	expect(f.issue).not.toHaveBeenCalled()
	expect(f.work).not.toHaveBeenCalled()
	f.owner.send({ type: 'SHUTDOWN' })
})

it('does not publish worker content for a different source identity', async () => {
	const f = fixture({
		extract: async () => ({ ...content, finalUrl: 'https://example.com/other' })
	})
	await waitFor(f.actor, (s) => s.matches('saved'))
	expect(f.actor.getSnapshot().context.content).toBeUndefined()
	expect(f.actor.getSnapshot().context.source).toBeUndefined()
	expect(f.work).toHaveBeenCalledWith({ url: capture.url })
	f.actor.send({ type: 'SHUTDOWN' })
	f.owner.send({ type: 'SHUTDOWN' })
})

it.each(['construction', 'post', 'worker', 'message', 'reply'] as const)(
	'preserves URL-only fallback after %s extraction failure and cleanup',
	async (failure) => {
		const worker = new TestJobWorker()
		if (failure === 'post')
			worker.postMessage.mockImplementation(() => {
				throw new Error('Refused')
			})
		const f = fixture({
			job: (value) => ({
				...extractionJob(value),
				open: () => {
					if (failure === 'construction') throw new Error('Unavailable')
					return worker
				}
			})
		})
		try {
			if (failure !== 'construction' && failure !== 'post') {
				await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce())
				if (failure === 'worker') worker.onerror?.()
				if (failure === 'message') worker.onmessageerror?.()
				if (failure === 'reply') worker.reply({ content: { title: 'unchecked' } })
			}
			await waitFor(f.actor, (s) => s.matches('saved'))
			expect(f.work).toHaveBeenCalledExactlyOnceWith({ url: capture.url })
			expect(worker.terminate).toHaveBeenCalledTimes(failure === 'construction' ? 0 : 1)
			expect(f.actor.getSnapshot().context.content).toBeUndefined()
		} finally {
			f.actor.send({ type: 'SHUTDOWN' })
			f.owner.send({ type: 'SHUTDOWN' })
		}
	}
)

it('rejects a completion at the extraction deadline before its timer is delivered', async () => {
	const reply = Promise.withResolvers<unknown>()
	let elapsed = 0
	const f = fixture({ extract: () => reply.promise, now: () => elapsed })
	await vi.waitFor(() => expect(f.extract).toHaveBeenCalledOnce())
	elapsed = 15000
	reply.resolve(content)
	await waitFor(f.actor, (s) => s.matches('saved'))
	expect(f.work).toHaveBeenCalledExactlyOnceWith({ url: capture.url })
	f.actor.send({ type: 'SHUTDOWN' })
	f.owner.send({ type: 'SHUTDOWN' })
})

it('cannot issue or save while native extraction cleanup is unconfirmed', async () => {
	const worker = new TestJobWorker()
	worker.terminate.mockImplementation(() => {
		throw new Error('Cleanup unavailable')
	})
	const f = fixture({ job: (value) => ({ ...extractionJob(value), open: () => worker }) })
	await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledOnce())
	worker.reply({ content })
	expect(f.actor.getSnapshot().matches({ running: { extracting: 'blocked' } })).toBe(true)
	f.clock.increment(15000)
	f.actor.send({ type: 'SHUTDOWN' })
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.issue).not.toHaveBeenCalled()
	expect(f.work).not.toHaveBeenCalled()
	f.actor.stop()
	f.owner.send({ type: 'SHUTDOWN' })
})

it('keeps remote rejection distinct from the confirmed local save', async () => {
	const global = Promise.withResolvers<void>()
	const f = fixture({
		write: Promise.resolve({
			kind: 'saved',
			operationId: id,
			ready: true,
			receipts: [{ global: () => global.promise }]
		})
	})
	await waitFor(f.actor, (s) => s.matches('saved'))
	global.reject(new Error('remote rejected'))
	await waitFor(f.actor, (s) => s.context.message?.variant === 'error')
	expect(f.actor.getSnapshot().context.message?.text).toContain('The server rejected this save.')
	expect(f.actor.getSnapshot().matches('saved')).toBe(true)
	expect(f.work).toHaveBeenCalledOnce()
	f.actor.send({ type: 'SHUTDOWN' })
	f.owner.send({ type: 'SHUTDOWN' })
})
