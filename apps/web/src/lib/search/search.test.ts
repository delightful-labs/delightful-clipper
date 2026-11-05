import { expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import { buildIndex, searchIndex } from './engine.js'
import { createSearchWorkerMachine } from './worker-machine.js'
import type { SearchDocument } from './schema.js'
const documents: SearchDocument[] = [
	{
		id: crypto.randomUUID(),
		title: 'Quiet reading',
		url: 'https://example.com/one',
		text: 'An orchard with pears and apples.',
		originalSavedAt: '2026-01-01'
	},
	{
		id: crypto.randomUUID(),
		title: 'Apples and pears',
		url: 'https://example.com/two',
		text: 'Quiet reading in an orchard.',
		originalSavedAt: '2026-01-02'
	},
	{
		id: crypto.randomUUID(),
		title: 'Another',
		url: 'https://example.com/needle',
		text: 'Only apples.',
		originalSavedAt: '2026-01-03'
	}
]
it('requires every keyword, boosts titles, searches URLs/body, and does not enable fuzzy or prefix matches', async () => {
	const index = await buildIndex(documents)
	expect(searchIndex(index, 'APPLES pears')).toEqual([documents[1]!.id, documents[0]!.id])
	expect(searchIndex(index, 'needle')).toEqual([documents[2]!.id])
	expect(searchIndex(index, 'orchard')).toHaveLength(2)
	expect(searchIndex(index, 'app')).toEqual([])
	expect(searchIndex(index, 'appls')).toEqual([])
})
it('rebuilds a corrupt derived cache and remains searchable when cache persistence fails', async () => {
	const reports: unknown[] = []
	const write = vi.fn(async () => {
		throw new Error('Storage blocked')
	})
	const actor = createActor(
		createSearchWorkerMachine({
			read: async () => {
				throw new Error('Corrupt cache')
			},
			write,
			report: (message) => reports.push(message)
		})
	).start()
	actor.send({ type: 'INDEX', key: 'account-one', generation: 1, documents })
	await waitFor(actor, (s) => s.matches('ready'))
	expect(write).toHaveBeenCalledOnce()
	actor.send({ type: 'QUERY', generation: 0, query: 'needle' })
	expect(reports).toHaveLength(1)
	actor.send({ type: 'QUERY', generation: 1, query: 'needle' })
	expect(reports.at(-1)).toMatchObject({ type: 'RESULT', generation: 1, ids: [documents[2]!.id] })
	actor.send({ type: 'STOP' })
	await toPromise(actor)
	expect(actor.getSnapshot().context.index).toBeUndefined()
})
it('restores a matching account cache and rejects older in-flight generations', async () => {
	const writes = new Map<string, { fingerprint: string; index: string }>()
	const reports: unknown[] = []
	const cap = {
		read: async (key: string) => writes.get(key),
		write: async (key: string, value: { fingerprint: string; index: string }) => {
			writes.set(key, value)
		},
		report: (message: unknown) => reports.push(message)
	}
	let actor = createActor(createSearchWorkerMachine(cap)).start()
	actor.send({ type: 'INDEX', key: 'account-one', generation: 1, documents })
	await waitFor(actor, (s) => s.matches('ready'))
	actor.send({ type: 'STOP' })
	await toPromise(actor)
	const write = vi.fn(cap.write)
	actor = createActor(createSearchWorkerMachine({ ...cap, write })).start()
	actor.send({ type: 'INDEX', key: 'account-one', generation: 2, documents })
	await waitFor(actor, (s) => s.matches('ready'))
	expect(write).not.toHaveBeenCalled()
	actor.send({ type: 'QUERY', generation: 1, query: 'needle' })
	expect(reports.at(-1)).toMatchObject({ type: 'INDEX_READY', generation: 2 })
	actor.send({ type: 'QUERY', generation: 2, query: 'needle' })
	expect(reports.at(-1)).toMatchObject({ type: 'RESULT', generation: 2, ids: [documents[2]!.id] })
	actor.send({ type: 'STOP' })
	await toPromise(actor)
})
