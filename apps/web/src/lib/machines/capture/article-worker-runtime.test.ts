import { it, expect, vi } from 'vitest'
import { createActor } from 'xstate'
import type { QueueCapability } from '../../contracts/article-worker.js'
import type { Article } from '../../contracts/articles.js'
import { createArticleWorkerRuntimeMachine } from './article-worker-runtime.js'
import type { SharedControl } from './article-worker-runtime.js'
const row: Article = {
	id: 'article',
	libraryId: 'library',
	url: 'https://example.com/',
	originalSavedAt: '2026-11-03T00:00:00.000Z',
	contentId: null,
	operationId: null,
	failure: null
}
function fixture(
	bus = new Set<(message: SharedControl) => void>(),
	overrides: Partial<QueueCapability> = {}
) {
	let lock: ((event: { type: 'LOCKED' | 'LOCK_FAILED' }) => void) | undefined
	let shared: ((message: SharedControl) => void) | undefined
	const cancel = vi.fn(),
		release = vi.fn(),
		failed = vi.fn(),
		close = vi.fn()
	const posts: SharedControl[] = []
	const resolve = vi.fn(async () => {
		throw new Error('gatewayUnavailable')
	})
	const fail = vi.fn(async () => {})
	const cap: QueueCapability = {
		libraryId: 'library',
		resolve,
		extract: async () => {
			throw new Error('unexpected extraction')
		},
		document: async () => false,
		intent: async () => false,
		save: async () => ({ kind: 'saved', operationId: 'article', ready: true }),
		fail,
		report: () => {},
		...overrides
	}
	let sequence = 0
	const actor = createActor(
		createArticleWorkerRuntimeMachine({
			queue: cap,
			commandId: () => `command-${++sequence}`,
			failed,
			claim: (report) => {
				lock = report
				return { cancel, release }
			},
			channel: (report) => {
				shared = report
				bus.add(report)
				return {
					post: (message) => {
						posts.push(message)
						for (const listener of bus) if (listener !== report) listener(message)
					},
					close: () => {
						bus.delete(report)
						close()
					}
				}
			}
		})
	).start()
	return {
		actor,
		cancel,
		release,
		failed,
		close,
		posts,
		resolve,
		fail,
		grant: () => lock?.({ type: 'LOCKED' }),
		reject: () => lock?.({ type: 'LOCK_FAILED' }),
		shared: (message: SharedControl) => shared?.(message)
	}
}
it('retains controls until owner acknowledgement and does not release a held/queued lease on STOP', () => {
	const f = fixture()
	f.actor.send({ type: 'RETRY', id: row.id })
	f.actor.send({ type: 'WAKE' })
	expect(Object.keys(f.actor.getSnapshot().context.pending)).toHaveLength(2)
	expect(f.posts.map((p) => p.type)).toEqual(['COMMAND', 'COMMAND'])
	const first = f.posts[0]
	if (!first) throw new Error('Missing command')
	f.shared({ type: 'ACK', id: first.id })
	expect(Object.keys(f.actor.getSnapshot().context.pending)).toHaveLength(1)
	f.actor.send({ type: 'STOP' })
	expect(f.cancel).toHaveBeenCalledOnce()
	expect(f.release).not.toHaveBeenCalled()
	expect(f.actor.getSnapshot().context.pending).toEqual({})
	f.grant()
	expect(f.resolve).not.toHaveBeenCalled()
	f.actor.stop()
	expect(f.release).toHaveBeenCalledOnce()
	expect(f.close).toHaveBeenCalledOnce()
})
it('routes second-tab Retry to the active owner and acknowledges delivery', async () => {
	const bus = new Set<(message: SharedControl) => void>()
	const first = fixture(bus),
		second = fixture(bus)
	first.grant()
	first.actor.send({ type: 'ROWS', rows: [row] })
	await vi.waitFor(() => expect(first.fail).toHaveBeenCalledOnce())
	second.actor.send({ type: 'RETRY', id: row.id })
	await vi.waitFor(() => expect(first.fail).toHaveBeenCalledTimes(2))
	expect(first.resolve).toHaveBeenCalledTimes(2)
	expect(second.resolve).not.toHaveBeenCalled()
	expect(second.actor.getSnapshot().context.pending).toEqual({})
	first.actor.send({ type: 'STOP' })
	second.actor.send({ type: 'STOP' })
	first.actor.stop()
	second.actor.stop()
})
it('delivers a cancellation retained before lock acquisition to the started queue', async () => {
	const pending = Promise.withResolvers<string>()
	let signal: AbortSignal | undefined
	const f = fixture(undefined, {
		resolve: (_url, _id, s) => {
			signal = s
			return pending.promise
		}
	})
	f.actor.send({ type: 'ROWS', rows: [row] })
	f.actor.send({ type: 'CANCEL', id: row.id })
	f.grant()
	await vi.waitFor(() => expect(f.fail).toHaveBeenCalledWith(row.id, 'canceled'))
	expect(signal?.aborted).toBe(true)
	f.actor.send({ type: 'STOP' })
	f.actor.stop()
})
it('keeps only the latest row snapshot while waiting and surfaces lock failures', async () => {
	const f = fixture()
	f.actor.send({ type: 'ROWS', rows: [row] })
	f.actor.send({ type: 'ROWS', rows: [] })
	f.grant()
	expect(f.resolve).not.toHaveBeenCalled()
	f.reject()
	expect(f.failed).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().matches({ owning: 'stopped' })).toBe(true)
	f.actor.stop()
})
