import { expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import { libraryMachine } from './library.js'
import type { LibraryCapability } from '../../contracts/library.js'
import type { Candidate } from '../../capture/source.js'
import type { SaveResult, ReadResult } from '../../contracts/storage.js'
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
function fixture(overrides: Partial<LibraryCapability> = {}) {
	const unsubscribe = vi.fn()
	const capability: LibraryCapability = {
		isCurrent: () => true,
		prepare: async () => ({ kind: 'preview', candidate }),
		save: async () => ({ kind: 'saved', operationId: candidate.id, receipts: [] }),
		read: async () => ({ kind: 'missing' }),
		subscribe: () => unsubscribe,
		...overrides
	}
	const actor = createActor(libraryMachine, { input: capability }).start()
	return { actor, capability, unsubscribe }
}
async function preview(actor: ReturnType<typeof fixture>['actor']) {
	actor.send({ type: 'ADD', url: 'https://example.com/' })
	await waitFor(actor, (s) => s.matches({ running: { capture: 'preview' } }))
}
it('drains issued local work before shutdown and clears all retained content', async () => {
	const pending = deferred<SaveResult>()
	let signal: AbortSignal | undefined
	const { actor, unsubscribe } = fixture({
		save: (_request, abort) => {
			signal = abort
			return pending.promise
		}
	})
	await preview(actor)
	actor.send({ type: 'SAVE' })
	await waitFor(actor, (s) => s.context.writing)
	actor.send({ type: 'SHUTDOWN' })
	expect(signal?.aborted).toBe(true)
	expect(actor.getSnapshot().status).toBe('active')
	expect(actor.getSnapshot().context.preview).toBeUndefined()
	pending.resolve({ kind: 'unknown', operationId: candidate.id })
	await toPromise(actor)
	expect(unsubscribe).toHaveBeenCalledOnce()
	expect(actor.getSnapshot().context).toMatchObject({
		preview: undefined,
		reader: undefined,
		rows: [],
		capability: undefined,
		sync: {}
	})
})
it('cancels extraction and discards a late result without enabling save', async () => {
	const pending = deferred<Awaited<ReturnType<LibraryCapability['prepare']>>>()
	let signal: AbortSignal | undefined
	const { actor } = fixture({
		prepare: (_url, abort) => {
			signal = abort
			return pending.promise
		}
	})
	actor.send({ type: 'ADD', url: 'https://example.com/' })
	actor.send({ type: 'CANCEL' })
	expect(signal?.aborted).toBe(true)
	pending.resolve({ kind: 'preview', candidate })
	await Promise.resolve()
	expect(actor.getSnapshot().can({ type: 'SAVE' })).toBe(false)
	expect(actor.getSnapshot().context.preview).toBeUndefined()
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
	await preview(actor)
	actor.send({ type: 'SAVE' })
	await waitFor(actor, (s) => s.context.sync[candidate.id] === 'pending')
	remote.reject(new Error('denied'))
	await waitFor(actor, (s) => s.context.sync[candidate.id] === 'rejected')
	expect(save).toHaveBeenCalledOnce()
	expect(actor.getSnapshot().can({ type: 'SAVE' })).toBe(false)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it.each(['unknown', 'blocked'] as const)(
	'offers reconciliation for %s without replay',
	async (kind) => {
		const save = vi.fn(async (): Promise<SaveResult> => ({ kind, operationId: candidate.id }))
		const { actor } = fixture({ save })
		await preview(actor)
		actor.send({ type: 'SAVE' })
		await waitFor(actor, (s) => s.matches({ running: { capture: 'uncertain' } }))
		actor.send({ type: 'SAVE' })
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
	await preview(actor)
	actor.send({ type: 'SAVE' })
	await waitFor(actor, (s) => s.context.sync[candidate.id] === 'pending')
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
	expect(actor.getSnapshot().status).toBe('done')
})
