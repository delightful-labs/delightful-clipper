import { promiseWorkerJob } from '../../web/src/lib/machines/browser-worker-job.test-support.js'
import { extractionReplySchema } from './protocol.js'
import { expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import type { Capture } from './protocol.js'
import { createRuntimeMachine } from './runtime-machine.js'
import { libraryMachine } from '../../web/src/lib/machines/capture/library.js'
import {
	controlledSave,
	testLibraryCapability
} from '../../web/src/lib/machines/capture/library.test-support.js'
import type { ArticleSaveResult } from '../../web/src/lib/contracts/articles.js'
const id = '77777777-7777-4777-8777-777777777777'
const next = '88888888-8888-4888-8888-888888888888'
const capture = {
	version: 1 as const,
	id,
	tabId: 7,
	documentId: 'document',
	url: 'https://example.com/article',
	phase: 'ready' as const
}
const content = {
	title: 'Article',
	text: 'Original text',
	html: '<p>Original text</p>',
	finalUrl: capture.url,
	provenance: '{}'
}
const saved: ArticleSaveResult = { kind: 'saved', operationId: id, ready: true, receipts: [] }
function fixture(
	write: Promise<ArticleSaveResult> = Promise.resolve(saved),
	marker = Promise.resolve(),
	current: () => boolean = () => true
) {
	const work = vi.fn(async () => write)
	const cancel = vi.fn()
	const save = controlledSave(work, cancel)
	const owner = createActor(libraryMachine, {
		input: testLibraryCapability(
			{ id, ...content, submittedUrl: capture.url, imagesMissing: false },
			{ spawnSave: (spawn, input) => spawn(save, { input }) }
		)
	}).start()
	const issue = vi.fn(async (_capture: Capture, _accountId: string) => marker)
	const report = vi.fn(async () => {})
	const reload = vi.fn(async () => {})
	const waiting = vi.fn(
		async (
			_ids: string[],
			_message: { text: string; variant: 'info' | 'error' },
			_revision: number
		) => {}
	)
	const runtime = createActor(
		createRuntimeMachine({
			reload,
			account: () => () => {},
			clip: (library) => ({
				library,
				accountId: id,
				current,
				read: async (requested) => ({
					capture: { ...capture, id: requested },
					source: { url: capture.url, base: capture.url, html: '<html>article</html>' }
				}),
				extraction: (source) =>
					promiseWorkerJob(
						source,
						(reply) => extractionReplySchema.parse(reply),
						async () => ({ content })
					),
				issue,
				remove: async () => {}
			}),
			report,
			waiting
		})
	).start()
	return {
		runtime,
		owner,
		work,
		issue,
		cancel,
		report,
		reload,
		waiting,
		close: () => {
			runtime.stop()
			owner.send({ type: 'SHUTDOWN' })
		}
	}
}
it('rejects unverified work before readiness and serializes verified native saves', async () => {
	const gate = Promise.withResolvers<ArticleSaveResult>()
	const f = fixture(gate.promise)
	expect(f.runtime.getSnapshot().can({ type: 'RUN', id, accountId: id })).toBe(false)
	f.runtime.send({ type: 'BIND', library: f.owner })
	f.runtime.send({ type: 'RUN', id, accountId: id })
	f.runtime.send({ type: 'RUN', id: next, accountId: id })
	await vi.waitFor(() => expect(f.work).toHaveBeenCalledOnce())
	expect(f.runtime.getSnapshot().context.queue).toEqual([next])
	expect(f.runtime.getSnapshot().can({ type: 'RUN', id, accountId: id })).toBe(false)
	gate.resolve(saved)
	await waitFor(f.runtime, (s) => s.matches({ job: 'observing' }) && s.context.id === next)
	expect(f.work).toHaveBeenCalledTimes(2)
	expect(f.issue.mock.calls.map(([capture]) => capture.id)).toEqual([id, next])
	expect(f.report).toHaveBeenCalled()
	f.close()
})
it('account loss drains the marker, discards queued old-account work, and never starts its native save', async () => {
	const marker = Promise.withResolvers<void>()
	const f = fixture(Promise.resolve(saved), marker.promise)
	f.runtime.send({ type: 'BIND', library: f.owner })
	f.runtime.send({ type: 'RUN', id, accountId: id })
	await vi.waitFor(() => expect(f.issue).toHaveBeenCalledOnce())
	f.runtime.send({ type: 'RUN', id: next, accountId: id })
	f.runtime.send({ type: 'BIND', library: undefined })
	expect(f.runtime.getSnapshot().matches({ job: 'draining' })).toBe(true)
	marker.resolve()
	await waitFor(f.runtime, (s) => s.matches('idle'))
	expect(f.runtime.getSnapshot().context.queue).toEqual([])
	expect(f.work).not.toHaveBeenCalled()
	f.close()
})
it('account loss waits for the issued native write to settle and does not replay its uncertain result', async () => {
	const gate = Promise.withResolvers<ArticleSaveResult>()
	const f = fixture(gate.promise)
	f.runtime.send({ type: 'BIND', library: f.owner })
	f.runtime.send({ type: 'RUN', id, accountId: id })
	await vi.waitFor(() => expect(f.work).toHaveBeenCalledOnce())
	f.runtime.send({ type: 'BIND', library: undefined })
	expect(f.cancel).toHaveBeenCalledOnce()
	expect(f.runtime.getSnapshot().matches({ job: 'draining' })).toBe(true)
	gate.resolve({ kind: 'unknown', operationId: id })
	await waitFor(f.runtime, (s) => s.matches('idle'))
	expect(f.work).toHaveBeenCalledOnce()
	f.close()
})

it('exposes the account owner failure to a queued source bar without issuing a write', () => {
	const f = fixture()
	const message = { text: 'Account unavailable', variant: 'error' as const }
	f.runtime.send({ type: 'BIND', library: undefined, message })
	f.runtime.send({ type: 'RUN', id, accountId: id })
	expect(f.runtime.getSnapshot().can({ type: 'RUN', id, accountId: id })).toBe(false)
	expect(f.issue).not.toHaveBeenCalled()
	f.close()
})

it('restoration drains an issued write before reloading and rejects jobs during that transition', async () => {
	const gate = Promise.withResolvers<ArticleSaveResult>()
	const f = fixture(gate.promise)
	f.runtime.send({ type: 'BIND', library: f.owner })
	f.runtime.send({ type: 'RUN', id, accountId: id })
	await vi.waitFor(() => expect(f.work).toHaveBeenCalledOnce())
	f.runtime.send({ type: 'ACCOUNT_CHANGED', accountId: next })
	expect(f.runtime.getSnapshot().matches({ job: 'restarting' })).toBe(true)
	expect(f.runtime.getSnapshot().can({ type: 'RUN', id: next, accountId: id })).toBe(false)
	expect(f.reload).not.toHaveBeenCalled()
	gate.resolve(saved)
	await vi.waitFor(() => expect(f.reload).toHaveBeenCalledOnce())
	expect(f.runtime.getSnapshot().can({ type: 'RUN', id: next, accountId: id })).toBe(false)
	f.close()
})

it('refuses a queued save for another account even if background admission was stale', () => {
	const f = fixture()
	f.runtime.send({ type: 'BIND', library: f.owner })
	f.runtime.send({ type: 'RUN', id, accountId: next })
	expect(f.runtime.getSnapshot().context.queue).toEqual([])
	expect(f.work).not.toHaveBeenCalled()
	f.close()
})

it('supervises an unexpected clip failure and refuses queued retries', async () => {
	const error = new Error('unexpected clip failure')
	const f = fixture(Promise.resolve(saved), Promise.resolve(), () => {
		throw error
	})
	f.runtime.send({ type: 'BIND', library: f.owner })
	f.runtime.send({ type: 'RUN', id, accountId: id })
	f.runtime.send({ type: 'RUN', id: next, accountId: id })
	await waitFor(f.runtime, (snapshot) => snapshot.matches('failed'))
	expect(f.runtime.getSnapshot().context.clipError).toBe(error)
	expect(f.runtime.getSnapshot().context.queue).toEqual([])
	expect(f.runtime.getSnapshot().can({ type: 'RUN', id: next, accountId: id })).toBe(false)
	expect(f.issue).not.toHaveBeenCalled()
	expect(f.work).not.toHaveBeenCalled()
	f.close()
})
