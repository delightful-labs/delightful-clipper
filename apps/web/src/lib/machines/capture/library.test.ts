import { controlledSave, testLibraryCapability } from './library.test-support.js'
import { expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import { libraryMachine } from './library.js'
import type { LibraryCapability } from '../../contracts/library.js'
import type { Candidate } from '../../capture/source.js'
import type { SaveRequest, SaveResult, ReadResult } from '../../contracts/storage.js'
const candidate: Candidate = {
	id: crypto.randomUUID(),
	title: 'Private article',
	text: 'Saved text',
	html: '<p>Saved text</p>',
	finalUrl: 'https://example.com/',
	submittedUrl: 'https://example.com/#intro',
	provenance: '{}',
	imagesMissing: false
}
function deferred<T>() {
	let resolve!: (value: T) => void
	let reject!: (reason: unknown) => void
	const promise = new Promise<T>((yes, no) => {
		resolve = yes
		reject = no
	})
	return { promise, resolve, reject }
}
function fixture(
	overrides: Omit<Partial<LibraryCapability>, 'read'> & {
		read?: (id: string, signal: AbortSignal) => Promise<ReadResult>
		save?: (request: SaveRequest) => Promise<SaveResult>
		shutdown?: () => void
	} = {}
) {
	const unsubscribe = vi.fn()
	const save = controlledSave(
		overrides.save ?? (async () => ({ kind: 'saved', operationId: candidate.id, receipts: [] })),
		overrides.shutdown
	)
	const capability = testLibraryCapability(candidate, {
		subscribe: () => unsubscribe,
		...overrides,
		read: {
			...testLibraryCapability(candidate).read,
			document: async (id, signal) => {
				await overrides.read?.(id, signal)
				return null
			}
		},
		spawnSave: (spawn, input) => spawn(save, { input })
	})
	const actor = createActor(libraryMachine, { input: capability }).start()
	return { actor, capability, unsubscribe }
}
async function add(actor: ReturnType<typeof fixture>['actor']) {
	actor.send({ type: 'ADD', url: 'https://example.com/' })
	await waitFor(
		actor,
		(s) =>
			s.context.writing ||
			s.matches({ running: { capture: 'saved' } }) ||
			s.matches({ running: { capture: 'uncertain' } })
	)
}
it('drains issued local work before shutdown and clears all retained content', async () => {
	const pending = deferred<SaveResult>()
	const shutdown = vi.fn()
	const { actor, unsubscribe } = fixture({
		save: () => pending.promise,
		shutdown
	})
	await add(actor)
	await waitFor(actor, (s) => s.context.writing)
	actor.send({ type: 'SHUTDOWN' })
	expect(shutdown).toHaveBeenCalledOnce()
	expect(actor.getSnapshot().status).toBe('active')
	expect(actor.getSnapshot().matches({ running: { capture: { saving: 'stopping' } } })).toBe(true)
	expect(
		Object.values(actor.getSnapshot().children).find(
			(child) => child?.id === actor.getSnapshot().context.saveRef?.id
		)
	).toBeDefined()
	expect(actor.getSnapshot().context.candidate).toBeUndefined()
	pending.resolve({ kind: 'unknown', operationId: candidate.id })
	await toPromise(actor)
	expect(unsubscribe).toHaveBeenCalledOnce()
	expect(
		Object.values(actor.getSnapshot().children).find(
			(child) => child?.id === actor.getSnapshot().context.saveRef?.id
		)
	).toBeUndefined()
	expect(actor.getSnapshot().context.saveRef).toBeUndefined()
	expect(actor.getSnapshot().context).toMatchObject({
		candidate: undefined,
		reader: undefined,
		rows: [],
		capability: undefined,
		sync: {}
	})
})
it('cancels extraction and discards a late result without issuing a write', async () => {
	const pending = deferred<string>()
	let signal: AbortSignal | undefined
	const { actor } = fixture({
		resolve: (_url, _id, abort) => {
			signal = abort
			return pending.promise
		}
	})
	actor.send({ type: 'ADD', url: 'https://example.com/' })
	actor.send({ type: 'CANCEL' })
	expect(signal?.aborted).toBe(true)
	pending.resolve(candidate.finalUrl)
	await Promise.resolve()
	expect(actor.getSnapshot().context.candidate).toBeUndefined()
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('reports late remote rejection separately from local saving without replay', async () => {
	const remote = deferred<void>(),
		save = vi.fn(async (): Promise<SaveResult> => ({
			kind: 'saved',
			operationId: candidate.id,
			receipts: [{ global: () => remote.promise }]
		}))
	const { actor } = fixture({ save })
	await add(actor)
	await waitFor(actor, (s) => s.context.sync[candidate.id] === 'pending')
	remote.reject(new Error('denied'))
	await waitFor(actor, (s) => s.context.sync[candidate.id] === 'rejected')
	expect(save).toHaveBeenCalledOnce()
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it.each(['unknown', 'blocked'] as const)(
	'offers reconciliation for %s without replay',
	async (kind) => {
		const save = vi.fn(async (): Promise<SaveResult> => ({ kind, operationId: candidate.id }))
		const { actor } = fixture({ save, hasIntent: async () => save.mock.calls.length > 0 })
		await add(actor)
		await waitFor(actor, (s) => s.matches({ running: { capture: 'uncertain' } }))
		actor.send({ type: 'ADD', url: candidate.finalUrl })
		await waitFor(actor, (s) => s.matches({ running: { capture: 'uncertain' } }))
		expect(save).toHaveBeenCalledOnce()
		expect(actor.getSnapshot().context.captureId).toBe(candidate.id)
		actor.send({ type: 'SHUTDOWN' })
		await toPromise(actor)
	}
)
it('aborts a reader on scope shutdown and ignores stale content', async () => {
	const pending = deferred<ReadResult>()
	let signal: AbortSignal | undefined
	const { actor } = fixture({
		read: (_id, abort) => {
			signal = abort
			return pending.promise
		}
	})
	actor.send({ type: 'OPEN', id: candidate.id })
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
	expect(signal?.aborted).toBe(true)
	pending.resolve({ kind: 'missing' })
	await Promise.resolve()
	expect(actor.getSnapshot().context.reader).toBeUndefined()
})
it('keeps pending remote acceptance from blocking session shutdown', async () => {
	const { actor } = fixture({
		save: async () => ({
			kind: 'saved',
			operationId: candidate.id,
			receipts: [{ global: () => new Promise(() => {}) }]
		})
	})
	await add(actor)
	await waitFor(actor, (s) => s.context.sync[candidate.id] === 'pending')
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
	expect(actor.getSnapshot().status).toBe('done')
})

it('sends cancellation once and keeps the child until its interrupted outcome', async () => {
	const pending = deferred<SaveResult>(),
		shutdown = vi.fn()
	const { actor } = fixture({ save: () => pending.promise, shutdown })
	await add(actor)
	actor.send({ type: 'CANCEL' })
	expect(actor.getSnapshot().matches({ running: { capture: { saving: 'stopping' } } })).toBe(true)
	expect(
		Object.values(actor.getSnapshot().children).find(
			(child) => child?.id === actor.getSnapshot().context.saveRef?.id
		)
	).toBeDefined()
	expect(shutdown).toHaveBeenCalledOnce()
	actor.send({ type: 'CANCEL' })
	expect(shutdown).toHaveBeenCalledOnce()
	pending.resolve({ kind: 'interrupted', operationId: candidate.id })
	await waitFor(actor, (s) => s.matches({ running: { capture: 'canceled' } }))
	expect(
		Object.values(actor.getSnapshot().children).find(
			(child) => child?.id === actor.getSnapshot().context.saveRef?.id
		)
	).toBeUndefined()
	expect(actor.getSnapshot().context.sync[candidate.id]).toBeUndefined()
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('handles a child actor failure as uncertain and removes it without replay', async () => {
	const save = vi.fn(async (): Promise<SaveResult> => {
		throw new Error('Lost child outcome')
	})
	const { actor } = fixture({ save })
	await add(actor)
	await waitFor(actor, (s) => s.matches({ running: { capture: 'uncertain' } }))
	expect(
		Object.values(actor.getSnapshot().children).find(
			(child) => child?.id === actor.getSnapshot().context.saveRef?.id
		)
	).toBeUndefined()
	expect(actor.getSnapshot().context.saveRef).toBeUndefined()
	expect(save).toHaveBeenCalledOnce()
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})

it('rejects stale reader generations after replacement and closing', async () => {
	const pending = deferred<ReadResult>(),
		signals: AbortSignal[] = []
	const { actor } = fixture({
		read: (_id, signal) => {
			signals.push(signal)
			return pending.promise
		}
	})
	actor.send({ type: 'OPEN', id: 'first' })
	const firstGeneration = actor.getSnapshot().context.readerGeneration
	actor.send({ type: 'OPEN', id: 'second' })
	const secondGeneration = actor.getSnapshot().context.readerGeneration
	expect(signals[0]?.aborted).toBe(true)
	actor.send({ type: 'READ_RESULT', generation: firstGeneration, result: { kind: 'corrupt' } })
	expect(actor.getSnapshot().context.reader).toBeUndefined()
	expect(actor.getSnapshot().matches({ running: { reading: 'loading' } })).toBe(true)
	actor.send({ type: 'CLOSE_READER' })
	expect(signals[1]?.aborted).toBe(true)
	actor.send({ type: 'READ_RESULT', generation: secondGeneration, result: { kind: 'missing' } })
	expect(actor.getSnapshot().context.reader).toBeUndefined()
	expect(actor.getSnapshot().matches({ running: { reading: 'empty' } })).toBe(true)
	pending.resolve({ kind: 'missing' })
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})

it('does not attach a new sync observer when a drained save finishes after shutdown', async () => {
	const pending = deferred<SaveResult>(),
		global = vi.fn(async () => {})
	const { actor } = fixture({ save: () => pending.promise })
	await add(actor)
	actor.send({ type: 'SHUTDOWN' })
	pending.resolve({ kind: 'saved', operationId: candidate.id, receipts: [{ global }] })
	await toPromise(actor)
	expect(global).not.toHaveBeenCalled()
	expect(actor.getSnapshot().context.sync).toEqual({})
})

it('automatically saves prepared content once and leaves the reader closed', async () => {
	const save = vi.fn(async (): Promise<SaveResult> => ({
		kind: 'saved',
		operationId: candidate.id,
		receipts: []
	}))
	const { actor } = fixture({ save })
	actor.send({ type: 'ADD', url: candidate.submittedUrl })
	await waitFor(actor, (s) => s.matches({ running: { capture: 'saved' } }))
	expect(save).toHaveBeenCalledOnce()
	expect(save).toHaveBeenCalledWith(
		expect.objectContaining({ operationId: candidate.id, text: candidate.text })
	)
	expect(actor.getSnapshot().context.candidate).toBeUndefined()
	expect(actor.getSnapshot().context.reader).toBeUndefined()
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})

it('keeps a pending capture alive while opening and closing a reader', async () => {
	const pending = deferred<string>()
	let signal: AbortSignal | undefined
	const { actor } = fixture({
		resolve: (_url, _id, abort) => {
			signal = abort
			return pending.promise
		}
	})
	actor.send({ type: 'ADD', url: candidate.finalUrl })
	expect(actor.getSnapshot().matches({ running: { capture: 'preparing' } })).toBe(true)
	actor.send({ type: 'OPEN', id: candidate.id })
	expect(actor.getSnapshot().matches({ running: { capture: 'preparing' } })).toBe(true)
	expect(signal?.aborted).toBe(false)
	actor.send({ type: 'CLOSE_READER' })
	expect(actor.getSnapshot().matches({ running: { capture: 'preparing' } })).toBe(true)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})

it('keeps the issued save child owned while opening and closing a reader', async () => {
	const pending = deferred<SaveResult>()
	const shutdown = vi.fn()
	const { actor } = fixture({ save: () => pending.promise, shutdown })
	await add(actor)
	const child = actor.getSnapshot().context.saveRef
	actor.send({ type: 'OPEN', id: crypto.randomUUID() })
	expect(actor.getSnapshot().context.saveRef).toBe(child)
	expect(actor.getSnapshot().context.writing).toBe(true)
	expect(shutdown).not.toHaveBeenCalled()
	actor.send({ type: 'CLOSE_READER' })
	expect(actor.getSnapshot().context.saveRef).toBe(child)
	actor.send({ type: 'SHUTDOWN' })
	expect(shutdown).toHaveBeenCalledOnce()
	pending.resolve({ kind: 'unknown', operationId: candidate.id })
	await toPromise(actor)
})
