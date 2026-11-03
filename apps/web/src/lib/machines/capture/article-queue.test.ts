import { expect, it, vi } from 'vitest'
import { createActor, waitFor, toPromise } from 'xstate'
import { createArticleQueueMachine } from './article-queue.js'
import type { Article } from '../../contracts/articles.js'
import type { QueueCapability } from '../../contracts/article-worker.js'
const libraryId = crypto.randomUUID()
function row(url: string): Article {
	return {
		id: crypto.randomUUID(),
		libraryId,
		url,
		originalSavedAt: new Date().toISOString(),
		contentId: null,
		operationId: null,
		failure: null
	}
}
function cap(overrides: Partial<QueueCapability> = {}): QueueCapability {
	return {
		libraryId,
		resolve: async (url) => url,
		extract: async (url, id) => ({
			id,
			title: 'Article',
			text: 'Text',
			html: '<p>Text</p>',
			finalUrl: url,
			submittedUrl: url,
			provenance: '{}',
			imagesMissing: false
		}),
		document: async () => false,
		intent: async () => false,
		save: async () => ({ kind: 'saved', operationId: crypto.randomUUID(), ready: true }),
		fail: async () => {},
		report: () => {},
		...overrides
	}
}
it('processes articles missing content one at a time and leaves the persisted rows as the source of work', async () => {
	const gate = Promise.withResolvers<void>()
	const order: string[] = []
	let active = 0,
		max = 0
	const save = vi.fn(async () => ({
		kind: 'saved' as const,
		operationId: crypto.randomUUID(),
		ready: true
	}))
	const actor = createActor(
		createArticleQueueMachine(
			cap({
				extract: async (url, id) => {
					active++
					max = Math.max(max, active)
					order.push(url)
					if (order.length === 1) await gate.promise
					active--
					return {
						id,
						title: 'Article',
						text: 'Text',
						html: '<p>Text</p>',
						finalUrl: url,
						submittedUrl: url,
						provenance: '{}',
						imagesMissing: false
					}
				},
				save
			})
		)
	).start()
	const rows = [row('https://example.com/one'), row('https://example.com/two')]
	actor.send({ type: 'ROWS', rows })
	await waitFor(actor, (s) => s.matches('extracting'))
	expect(order).toHaveLength(1)
	gate.resolve()
	await waitFor(actor, () => save.mock.calls.length === 2)
	expect(max).toBe(1)
	expect(order).toEqual(rows.map((r) => r.url))
	actor.send({ type: 'STOP' })
	await toPromise(actor)
})
it('reconciles a reserved publication before fetching and never replays an unknown one', async () => {
	const resolve = vi.fn(async (url: string) => url),
		save = vi.fn(async () => ({ kind: 'saved' as const, operationId: '', ready: true })),
		fail = vi.fn(async () => {})
	const actor = createActor(createArticleQueueMachine(cap({ resolve, save, fail }))).start()
	actor.send({
		type: 'ROWS',
		rows: [{ ...row('https://example.com/'), operationId: crypto.randomUUID() }]
	})
	await waitFor(actor, () => fail.mock.calls.length === 1)
	expect(resolve).not.toHaveBeenCalled()
	expect(save).not.toHaveBeenCalled()
	actor.send({ type: 'STOP' })
	await toPromise(actor)
})
it('retains failure without a tight retry loop and retries explicitly on the same article', async () => {
	const resolve = vi.fn(async () => {
			throw new Error('captureFailed')
		}),
		fail = vi.fn(async () => {})
	const actor = createActor(createArticleQueueMachine(cap({ resolve, fail }))).start()
	const article = row('https://example.com/')
	actor.send({ type: 'ROWS', rows: [article] })
	await waitFor(actor, () => fail.mock.calls.length === 1)
	actor.send({ type: 'ROWS', rows: [article] })
	expect(resolve).toHaveBeenCalledOnce()
	actor.send({ type: 'RETRY', id: article.id })
	await waitFor(actor, () => fail.mock.calls.length === 2)
	expect(resolve).toHaveBeenCalledTimes(2)
	actor.send({ type: 'STOP' })
	await toPromise(actor)
})
