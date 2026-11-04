import { controlledSave, testLibraryCapability } from './library.test-support.js'
import { expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import { libraryMachine, selectLibraryView } from './library.js'
import type { ArticleSaveResult, SaveArticleRequest } from '../../contracts/articles.js'
const id = crypto.randomUUID()
const candidate = {
	id,
	title: 'Private',
	text: 'Text',
	html: '<p>Text</p>',
	finalUrl: 'https://example.com/',
	submittedUrl: 'https://example.com/',
	provenance: '{}',
	imagesMissing: false
}
function fixture(
	work: (r: SaveArticleRequest) => Promise<ArticleSaveResult> = async () => ({
		kind: 'saved',
		operationId: id,
		ready: false,
		receipts: []
	})
) {
	const shutdown = vi.fn(),
		unsubscribe = vi.fn(),
		save = controlledSave(work, shutdown)
	const cap = testLibraryCapability(candidate, {
		subscribe: () => unsubscribe,
		spawnSave: (spawn, input) => spawn(save, { input })
	})
	const actor = createActor(libraryMachine, { input: cap }).start()
	return { actor, shutdown, unsubscribe }
}
it('Add Link saves only the URL immediately without a capture preparation phase', async () => {
	const save = vi.fn(async (): Promise<ArticleSaveResult> => ({
		kind: 'saved',
		operationId: id,
		ready: false,
		receipts: []
	}))
	const { actor } = fixture(save)
	actor.send({ type: 'ADD', url: candidate.submittedUrl })
	await waitFor(actor, (s) => s.matches({ running: { capture: 'saved' } }))
	expect(save).toHaveBeenCalledWith({ url: candidate.submittedUrl })
	expect(selectLibraryView(actor.getSnapshot()).canOpenCapture).toBe(false)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('drains a URL write and the worker resource before closing the account scope', async () => {
	const gate = Promise.withResolvers<ArticleSaveResult>()
	const { actor, shutdown, unsubscribe } = fixture(() => gate.promise)
	actor.send({ type: 'ADD', url: candidate.finalUrl })
	await waitFor(actor, (s) => s.context.writing)
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().status).toBe('active')
	expect(shutdown).toHaveBeenCalledOnce()
	gate.resolve({ kind: 'unknown', operationId: id })
	await toPromise(actor)
	expect(unsubscribe).toHaveBeenCalledOnce()
	expect(actor.getSnapshot().context.capability).toBeUndefined()
	expect(actor.getSnapshot().context.rows).toEqual([])
})
it('keeps URL persistence independent of reader navigation', async () => {
	const gate = Promise.withResolvers<ArticleSaveResult>()
	const { actor, shutdown } = fixture(() => gate.promise)
	actor.send({ type: 'ADD', url: candidate.finalUrl })
	const child = actor.getSnapshot().context.saveRef
	actor.send({ type: 'OPEN', id })
	actor.send({ type: 'CLOSE_READER' })
	expect(actor.getSnapshot().context.saveRef).toBe(child)
	expect(shutdown).not.toHaveBeenCalled()
	gate.resolve({ kind: 'saved', operationId: id, ready: false, receipts: [] })
	await waitFor(actor, (s) => !s.context.writing)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('offers a reader only when background content has actually completed', async () => {
	const { actor } = fixture()
	actor.send({ type: 'ADD', url: candidate.finalUrl })
	await waitFor(actor, (s) => s.matches({ running: { capture: 'saved' } }))
	actor.send({
		type: 'BACKGROUND_SAVED',
		result: { kind: 'saved', operationId: id, ready: true, receipts: [] }
	})
	expect(selectLibraryView(actor.getSnapshot()).canOpenCapture).toBe(true)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('keeps global rejection separate from local article and content saves', async () => {
	const remote = Promise.withResolvers<void>()
	const { actor } = fixture(async () => ({
		kind: 'saved',
		operationId: id,
		ready: false,
		receipts: [{ global: () => remote.promise }]
	}))
	actor.send({ type: 'ADD', url: candidate.finalUrl })
	await waitFor(actor, (s) => s.context.sync[id] === 'pending')
	remote.reject(new Error('Denied'))
	await waitFor(actor, (s) => s.context.sync[id] === 'rejected')
	expect(selectLibraryView(actor.getSnapshot()).captureMessage?.variant).toBe('error')
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('localizes pending article failures in the owner and does not offer a fake reader', async () => {
	const { actor } = fixture()
	actor.send({
		type: 'ROWS',
		rows: [
			{
				id,
				title: candidate.finalUrl,
				url: candidate.finalUrl,
				contentId: null,
				originalSavedAt: new Date().toISOString(),
				failure: 'captureFailed'
			}
		]
	})
	expect(selectLibraryView(actor.getSnapshot()).rowMessages[id]?.text).toContain(
		'could not be fetched'
	)
	expect(selectLibraryView(actor.getSnapshot()).canOpenCapture).toBe(false)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('rejects invalid URLs before creating a save actor', async () => {
	const save = vi.fn(async (): Promise<ArticleSaveResult> => ({
		kind: 'saved',
		operationId: id,
		receipts: []
	}))
	const { actor } = fixture(save)
	actor.send({ type: 'ADD', url: 'javascript:alert(1)' })
	expect(save).not.toHaveBeenCalled()
	expect(selectLibraryView(actor.getSnapshot()).captureMessage?.text).toContain('HTTP or HTTPS')
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})

it.each([
	{ order: 'before', variant: 'info' as const },
	{ order: 'after', variant: 'info' as const },
	{ order: 'before', variant: 'error' as const },
	{ order: 'after', variant: 'error' as const }
])(
	'keeps synced content readable when worker $variant status arrives $order the content row',
	async ({ order, variant }) => {
		const { actor } = fixture()
		const status = {
			type: 'BACKGROUND_STATUS' as const,
			id,
			cancelable: false,
			message: { text: 'Worker fixture status', variant }
		}
		if (order === 'before') actor.send(status)
		actor.send({
			type: 'ROWS',
			rows: [
				{
					id,
					title: candidate.title,
					url: candidate.finalUrl,
					contentId: id,
					originalSavedAt: '2026-11-03T12:00:00.000Z',
					failure: null
				}
			]
		})
		if (order === 'after') actor.send(status)
		const view = selectLibraryView(actor.getSnapshot())
		expect(view.readable[id]).toBe(true)
		// Merely observing a content row does not synthesize this client's save confirmation.
		expect(view.canOpenCapture).toBe(false)
		actor.send({ type: 'SHUTDOWN' })
		await toPromise(actor)
	}
)
