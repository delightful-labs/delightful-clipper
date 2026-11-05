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
	await waitFor(actor, (s) => s.matches({ running: { capture: 'saving' } }))
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
	await waitFor(actor, (s) => !s.matches({ running: { capture: 'saving' } }))
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

it.each(['write-first', 'worker-first'] as const)(
	'joins write and worker shutdown in either order (%s)',
	async (order) => {
		const pending = Promise.withResolvers<ArticleSaveResult>()
		const work = vi.fn(() => pending.promise)
		const shutdown = vi.fn()
		const save = controlledSave(work, shutdown)
		let report:
			| ((event: import('../../contracts/article-worker.js').QueueReport) => void)
			| undefined
		const send = vi.fn()
		const cap = testLibraryCapability(candidate, {
			spawnSave: (spawn, input) => spawn(save, { input }),
			worker: (next) => {
				report = next
				return { send, stop: async () => {} }
			}
		})
		const actor = createActor(libraryMachine, { input: cap }).start()
		actor.send({ type: 'ADD', url: candidate.submittedUrl })
		await vi.waitFor(() => expect(work).toHaveBeenCalledOnce())
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'ADD', url: 'https://example.com/another' })
		actor.send({ type: 'OPEN', id: 'another' })
		expect(selectLibraryView(actor.getSnapshot()).captureMessage).toBeUndefined()
		expect(shutdown).toHaveBeenCalledOnce()
		expect(send.mock.calls.filter(([event]) => event.type === 'STOP')).toHaveLength(1)
		if (order === 'worker-first') report?.({ type: 'BACKGROUND_CLOSED' })
		else {
			pending.resolve({ kind: 'unknown', operationId: id })
			await waitFor(actor, (s) => !s.matches({ running: { capture: 'saving' } }))
		}
		expect(actor.getSnapshot().status).toBe('active')
		if (order === 'worker-first') pending.resolve({ kind: 'unknown', operationId: id })
		else report?.({ type: 'BACKGROUND_CLOSED' })
		await toPromise(actor)
		expect(work).toHaveBeenCalledOnce()
		expect(actor.getSnapshot().context.capability).toBeUndefined()
	}
)
it('keeps an issued reader read when unrelated organization rows arrive', async () => {
	const entered = Promise.withResolvers<void>(),
		gate = Promise.withResolvers<import('../../contracts/storage.js').DocumentHeader | null>()
	const document = {
		id,
		libraryId: 'library',
		operationId: id,
		snapshotId: id,
		assetId: id,
		title: candidate.title,
		originalSavedAt: ''
	}
	const read = vi.fn(async () => {
		entered.resolve()
		return gate.promise
	})
	const actor = createActor(libraryMachine, {
		input: testLibraryCapability(candidate, {
			read: {
				isCurrent: () => true,
				document: read,
				snapshot: async () => ({
					id,
					libraryId: 'library',
					documentId: id,
					text: candidate.text,
					formatVersion: '1'
				}),
				asset: async () => null,
				source: async () => null
			}
		})
	}).start()
	try {
		actor.send({ type: 'OPEN', id })
		await entered.promise
		const generation = actor.getSnapshot().context.readerGeneration
		for (const favorite of [true, false, true])
			actor.send({
				type: 'ROWS',
				rows: [
					{
						id,
						title: candidate.title,
						url: candidate.finalUrl,
						contentId: id,
						originalSavedAt: '',
						failure: null,
						favorite
					}
				]
			})
		expect(actor.getSnapshot().context.readerGeneration).toBe(generation)
		expect(read).toHaveBeenCalledOnce()
		gate.resolve(document)
		await waitFor(actor, (s) => s.context.reader?.kind === 'available')
	} finally {
		gate.resolve(document)
		actor.send({ type: 'SHUTDOWN' })
		await toPromise(actor)
	}
})
it('still reopens a missing link-only reader when its content arrives', async () => {
	const document = {
		id,
		libraryId: 'library',
		operationId: id,
		snapshotId: id,
		assetId: id,
		title: candidate.title,
		originalSavedAt: ''
	}
	let present = false
	const read = vi.fn(async () => (present ? document : null))
	const actor = createActor(libraryMachine, {
		input: testLibraryCapability(candidate, {
			read: {
				isCurrent: () => true,
				document: read,
				snapshot: async () => ({
					id,
					libraryId: 'library',
					documentId: id,
					text: candidate.text,
					formatVersion: '1'
				}),
				asset: async () => null,
				source: async () => null
			}
		})
	}).start()
	actor.send({ type: 'OPEN', id })
	await waitFor(actor, (s) => s.context.reader?.kind === 'missing')
	present = true
	actor.send({
		type: 'ROWS',
		rows: [
			{
				id,
				title: candidate.title,
				url: candidate.finalUrl,
				contentId: id,
				originalSavedAt: '',
				failure: null
			}
		]
	})
	await waitFor(actor, (s) => s.context.reader?.kind === 'available')
	expect(read).toHaveBeenCalledTimes(2)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})

it('uses readable state names for capture outcomes and passes through worker feedback', async () => {
	const gate = Promise.withResolvers<ArticleSaveResult>()
	const { actor } = fixture(() => gate.promise)
	actor.send({ type: 'ADD', url: candidate.finalUrl })
	expect(selectLibraryView(actor.getSnapshot()).captureMessage).toEqual({
		text: 'Saving on this device…',
		variant: 'info'
	})
	gate.resolve({ kind: 'saved', operationId: id, ready: false, receipts: [] })
	await waitFor(actor, (s) => s.matches({ running: { capture: { saved: 'local' } } }))
	expect(
		Object.values(actor.getSnapshot().getMeta()).some(
			(meta) => meta?.name === selectLibraryView(actor.getSnapshot()).captureMessage?.text
		)
	).toBe(true)
	actor.send({ type: 'SYNC', id, status: 'accepted' })
	expect(actor.getSnapshot().matches({ running: { capture: { saved: 'synced' } } })).toBe(true)
	expect(selectLibraryView(actor.getSnapshot()).captureMessage?.text).toBe('Article synced.')
	const message = { text: 'Worker-owned status', variant: 'info' as const }
	actor.send({ type: 'BACKGROUND_STATUS', id, message, cancelable: true })
	expect(actor.getSnapshot().matches({ running: { capture: { saved: 'background' } } })).toBe(true)
	expect(selectLibraryView(actor.getSnapshot()).captureMessage).toBe(message)
	actor.send({
		type: 'BACKGROUND_SAVED',
		result: { kind: 'saved', operationId: id, ready: true, receipts: [] }
	})
	expect(actor.getSnapshot().matches({ running: { capture: { saved: 'synced' } } })).toBe(true)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})

it('keeps the duplicate state label when receipt status changes', async () => {
	const { actor } = fixture(async () => ({
		kind: 'duplicate',
		operationId: id,
		ready: true,
		receipts: []
	}))
	actor.send({ type: 'ADD', url: candidate.finalUrl })
	await waitFor(actor, (s) => s.matches({ running: { capture: { saved: 'duplicate' } } }))
	actor.send({ type: 'SYNC', id, status: 'rejected' })
	expect(actor.getSnapshot().matches({ running: { capture: { saved: 'duplicate' } } })).toBe(true)
	expect(selectLibraryView(actor.getSnapshot()).captureMessage?.text).toBe('Already saved.')
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})

it('retains the worker failure name without terminating an issued save or skipping its drain', async () => {
	const gate = Promise.withResolvers<ArticleSaveResult>()
	const { actor, shutdown } = fixture(() => gate.promise)
	actor.send({ type: 'ADD', url: candidate.finalUrl })
	const save = actor.getSnapshot().context.saveRef
	actor.send({ type: 'BACKGROUND_ERROR' })
	actor.send({ type: 'BACKGROUND_CLOSED' })
	expect(actor.getSnapshot().context.saveRef).toBe(save)
	expect(shutdown).not.toHaveBeenCalled()
	expect(actor.getSnapshot().matches({ running: { workerLifecycle: { failed: 'closed' } } })).toBe(
		true
	)
	expect(selectLibraryView(actor.getSnapshot()).captureMessage?.variant).toBe('error')
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().status).toBe('active')
	expect(selectLibraryView(actor.getSnapshot()).captureMessage).toBeUndefined()
	gate.resolve({ kind: 'saved', operationId: id, receipts: [] })
	await toPromise(actor)
})

it('replaces a worker failure name when the in-flight URL save succeeds', async () => {
	const gate = Promise.withResolvers<ArticleSaveResult>()
	const { actor } = fixture(() => gate.promise)
	actor.send({ type: 'ADD', url: candidate.finalUrl })
	actor.send({ type: 'BACKGROUND_ERROR' })
	actor.send({ type: 'BACKGROUND_CLOSED' })
	gate.resolve({ kind: 'saved', operationId: id, receipts: [] })
	await waitFor(actor, (s) => s.matches({ running: { capture: { saved: 'local' } } }))
	expect(actor.getSnapshot().matches({ running: { workerLifecycle: 'closed' } })).toBe(true)
	expect(selectLibraryView(actor.getSnapshot()).captureMessage?.variant).toBe('info')
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
