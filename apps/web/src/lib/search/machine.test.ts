import { expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import { createSearchMachine, selectSearchView } from './machine.js'
import type { SearchCapability } from '../contracts/search.js'
import type { SearchWorkerOutput, SearchWorkerInput } from './protocol.js'
import type { LibraryArticle } from '../contracts/articles.js'
const id = crypto.randomUUID()
const row: LibraryArticle = {
	id,
	title: 'Library article',
	url: 'https://example.com',
	contentId: null,
	originalSavedAt: '2026-01-01',
	failure: null
}
const machine = createSearchMachine()
function fixture() {
	let report: ((event: SearchWorkerOutput) => void) | undefined
	const posted: SearchWorkerInput[] = []
	const dispose = vi.fn(),
		unsubscribe = vi.fn()
	const load = vi.fn(async (rows: LibraryArticle[]) =>
		rows.map((row) => ({
			id: row.id,
			title: row.title,
			url: row.url ?? '',
			text: 'Saved text',
			tags: (row.tags ?? []).map((tag) => tag.name).join(' '),
			originalSavedAt: row.originalSavedAt
		}))
	)
	const cap: SearchCapability = {
		libraryId: 'deployment/account-one',
		isCurrent: () => true,
		load,
		observe: () => unsubscribe,
		open: (next) => {
			report = next
			return { post: (event) => posted.push(event), dispose }
		}
	}
	const actor = createActor(machine, { input: { capability: cap } }).start()
	actor.send({ type: 'ACTIVATE' })
	return {
		actor,
		posted,
		dispose,
		unsubscribe,
		load,
		cap,
		report: (event: SearchWorkerOutput) => report?.(event)
	}
}
it('keeps only current dataset/query results and ignores organization-only metadata changes', async () => {
	const f = fixture()
	f.actor.send({ type: 'ROWS', rows: [row] })
	await waitFor(f.actor, (s) => s.matches({ running: 'indexing' }))
	const generation = f.actor.getSnapshot().context.generation
	f.report({ type: 'INDEX_READY', generation: generation - 1 })
	expect(f.actor.getSnapshot().matches({ running: 'indexing' })).toBe(true)
	f.actor.send({ type: 'QUERY', query: 'needle' })
	f.report({ type: 'INDEX_READY', generation })
	f.report({ type: 'RESULT', generation, query: 'old query', ids: [crypto.randomUUID()] })
	expect(selectSearchView(f.actor.getSnapshot()).ids).toBeUndefined()
	f.report({ type: 'RESULT', generation, query: 'needle', ids: [id] })
	expect(selectSearchView(f.actor.getSnapshot()).ids).toEqual([id])
	const calls = f.load.mock.calls.length
	f.actor.send({ type: 'ROWS', rows: [{ ...row, favorite: true, trashed: true }] })
	expect(f.load.mock.calls).toHaveLength(calls)
	expect(
		f.posted
			.filter((event) => event.type === 'INDEX')
			.every((event) => event.key === 'clipper-search-v1:deployment/account-one')
	).toBe(true)
	f.actor.send({ type: 'STOP' })
	await toPromise(f.actor)
	expect(f.unsubscribe).toHaveBeenCalledOnce()
	expect(f.dispose).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().context).toMatchObject({
		rows: [],
		query: '',
		ids: [],
		capability: undefined
	})
})
it('releases failed resources and creates a fresh worker on retry', async () => {
	const f = fixture()
	await waitFor(f.actor, (s) => s.matches({ running: 'indexing' }))
	f.report({ type: 'WORKER_ERROR' })
	expect(selectSearchView(f.actor.getSnapshot()).canRetry).toBe(true)
	expect(selectSearchView(f.actor.getSnapshot()).message).toEqual({
		text: 'Search is unavailable.',
		variant: 'error'
	})
	expect(f.dispose).toHaveBeenCalledOnce()
	f.actor.send({ type: 'RETRY' })
	await waitFor(f.actor, (s) => s.matches({ running: 'indexing' }))
	expect(f.actor.getSnapshot().context.generation).toBe(1)
	f.actor.send({ type: 'STOP' })
	await toPromise(f.actor)
	expect(f.dispose).toHaveBeenCalledTimes(2)
})
it('contains worker construction failure inside the search workflow', async () => {
	const f = fixture()
	f.actor.send({ type: 'STOP' })
	await toPromise(f.actor)
	const actor = createActor(machine, {
		input: {
			capability: {
				...f.cap,
				open: () => {
					throw new Error('Worker blocked')
				}
			}
		}
	}).start()
	actor.send({ type: 'ACTIVATE' })
	await waitFor(actor, (s) => s.matches('failed'))
	expect(actor.getSnapshot().status).toBe('active')
	actor.send({ type: 'STOP' })
	await toPromise(actor)
})
it('requests cancellation and drains an old bound read before acknowledging shutdown', async () => {
	const gate =
		Promise.withResolvers<
			ReturnType<SearchCapability['load']> extends Promise<infer T> ? T : never
		>()
	const signals: AbortSignal[] = []
	const f = fixture()
	f.actor.send({ type: 'STOP' })
	await toPromise(f.actor)
	const actor = createActor(machine, {
		input: {
			capability: {
				...f.cap,
				load: async (_rows, signal) => {
					signals.push(signal)
					return gate.promise
				}
			}
		}
	}).start()
	actor.send({ type: 'ROWS', rows: [row] })
	actor.send({ type: 'ACTIVATE' })
	await vi.waitFor(() => expect(signals).toHaveLength(1))
	actor.send({ type: 'STOP' })
	expect(actor.getSnapshot().status).toBe('active')
	expect(signals.at(-1)?.aborted).toBe(true)
	gate.resolve([
		{
			id,
			title: row.title,
			url: row.url!,
			text: 'Late private content',
			tags: (row.tags ?? []).map((tag) => tag.name).join(' '),
			originalSavedAt: row.originalSavedAt
		}
	])
	await toPromise(actor)
	expect(actor.getSnapshot().context.rows).toEqual([])
})

it('discards a native read after its fixed account scope expires and releases its worker', async () => {
	const gate = Promise.withResolvers<import('./schema.js').SearchDocument[]>()
	const f = fixture()
	f.actor.send({ type: 'STOP' })
	await toPromise(f.actor)
	let current = true
	f.posted.length = 0
	f.dispose.mockClear()
	const actor = createActor(machine, {
		input: { capability: { ...f.cap, isCurrent: () => current, load: () => gate.promise } }
	}).start()
	actor.send({ type: 'ACTIVATE' })
	await waitFor(actor, (s) => s.matches({ running: 'loading' }))
	current = false
	gate.resolve([])
	await toPromise(actor)
	expect(f.posted).toEqual([])
	expect(f.dispose).toHaveBeenCalledOnce()
	expect(selectSearchView(actor.getSnapshot()).ids).toBeUndefined()
})

it('reindexes tag additions, display changes and removals while keeping the query', async () => {
	const f = fixture()
	f.actor.send({ type: 'QUERY', query: 'reading' })
	for (const tags of [
		[{ key: 'reading', name: 'Reading' }],
		[{ key: 'reading', name: 'READING' }],
		[]
	]) {
		const generation = f.actor.getSnapshot().context.generation
		f.actor.send({ type: 'ROWS', rows: [{ ...row, tags }] })
		await waitFor(f.actor, (s) => s.matches({ running: 'indexing' }))
		expect(f.actor.getSnapshot().context.generation).toBe(generation + 1)
		expect(f.actor.getSnapshot().context.query).toBe('reading')
		expect(f.posted.at(-1)).toMatchObject({
			type: 'INDEX',
			documents: [{ tags: tags.map((tag) => tag.name).join(' ') }]
		})
		f.report({ type: 'INDEX_READY', generation: generation + 1 })
		f.report({ type: 'RESULT', generation: generation + 1, query: 'reading', ids: [] })
	}
	f.actor.send({ type: 'STOP' })
	await toPromise(f.actor)
})

it('does not acquire a worker, observe snapshots or load article text until search is requested', async () => {
	const f = fixture()
	f.actor.send({ type: 'STOP' })
	await toPromise(f.actor)
	const open = vi.fn(f.cap.open),
		observe = vi.fn(f.cap.observe)
	f.load.mockClear()
	const actor = createActor(machine, { input: { capability: { ...f.cap, open, observe } } }).start()
	actor.send({ type: 'ROWS', rows: [row] })
	actor.send({ type: 'QUERY', query: '' })
	expect(actor.getSnapshot().matches('dormant')).toBe(true)
	expect(open).not.toHaveBeenCalled()
	expect(observe).not.toHaveBeenCalled()
	expect(f.load).not.toHaveBeenCalled()
	actor.send({ type: 'QUERY', query: 'needle' })
	await waitFor(actor, (s) => s.matches({ running: 'indexing' }))
	expect(f.load).toHaveBeenCalledOnce()
	expect(f.load.mock.calls[0]?.[0]).toEqual([row])
	expect(actor.getSnapshot().context.query).toBe('needle')
	actor.send({ type: 'STOP' })
	await toPromise(actor)
})

it('drains one native load and coalesces invalidations into one load of the latest rows', async () => {
	const f = fixture()
	f.actor.send({ type: 'STOP' })
	await toPromise(f.actor)
	const pending = Promise.withResolvers<import('./schema.js').SearchDocument[]>()
	const load = vi
		.fn<SearchCapability['load']>()
		.mockImplementationOnce(() => pending.promise)
		.mockResolvedValue([])
	f.posted.length = 0
	const actor = createActor(machine, { input: { capability: { ...f.cap, load } } }).start()
	actor.send({ type: 'ACTIVATE' })
	await vi.waitFor(() => expect(load).toHaveBeenCalledOnce())
	actor.send({ type: 'ROWS', rows: [row] })
	actor.send({ type: 'DIRTY' })
	const latest = { ...row, title: 'Latest' }
	actor.send({ type: 'ROWS', rows: [latest] })
	expect(load).toHaveBeenCalledOnce()
	pending.resolve([])
	await waitFor(actor, (s) => s.matches({ running: 'indexing' }))
	expect(load).toHaveBeenCalledTimes(2)
	expect(load.mock.calls[1]?.[0]).toEqual([latest])
	expect(f.posted.filter((e) => e.type === 'INDEX')).toHaveLength(1)
	actor.send({ type: 'STOP' })
	await toPromise(actor)
})
