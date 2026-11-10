import { beforeAll, expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import type { LinkStatus } from 'jazz-tools'
import type { ReadCapabilities, ReadResult } from '../../contracts/storage.js'
import { prepareSave } from '../../storage/prepare.js'
import { readRecordMachine } from './read.js'

let draft: Awaited<ReturnType<typeof prepareSave>>
beforeAll(async () => {
	draft = await prepareSave(crypto.randomUUID(), {
		operationId: crypto.randomUUID(),
		title: 'Startup fixture',
		text: 'Saved text must survive connection startup.',
		bytes: new Uint8Array([1, 2, 3]),
		mediaType: 'text/plain'
	})
})
function connection(initial: LinkStatus['state'] = 'connecting') {
	let state = initial
	const observed = Promise.withResolvers<void>()
	const listeners = new Set<(state: LinkStatus['state']) => void>()
	return {
		observed: observed.promise,
		listeners,
		observeConnection: vi.fn((next: (state: LinkStatus['state']) => void) => {
			listeners.add(next)
			observed.resolve()
			next(state)
			return () => {
				listeners.delete(next)
			}
		}),
		emit(next: LinkStatus['state']) {
			state = next
			for (const listener of listeners) listener(state)
		}
	}
}
function fixture(boundary: 'document' | 'snapshot' | 'asset' = 'snapshot') {
	const link = connection()
	let present = false,
		current = true
	const capability = {
		isCurrent: () => current,
		observeConnection: link.observeConnection,
		document: vi.fn(async () => (boundary === 'document' && !present ? null : draft.document)),
		snapshot: vi.fn(async (_id: string, _signal: AbortSignal) =>
			boundary === 'snapshot' && !present ? null : draft.snapshot
		),
		asset: vi.fn(async () => (boundary === 'asset' && !present ? null : draft.asset)),
		source: async () => null
	} satisfies ReadCapabilities
	const results: ReadResult[] = []
	const actor = createActor(readRecordMachine, { input: { id: draft.document.id, capability } })
	actor.on('record', ({ result }) => results.push(result))
	actor.start()
	return {
		actor,
		capability,
		results,
		link,
		store() {
			present = true
		},
		loseScope() {
			current = false
		},
		waiting: () => link.observed
	}
}
it.each(['document', 'snapshot', 'asset'] as const)(
	'keeps a partial replica pending through connection startup at %s',
	async (boundary) => {
		const f = fixture(boundary)
		await f.waiting()
		expect(f.results).toEqual([])
		f.link.emit('connecting')
		expect(f.capability[boundary]).toHaveBeenCalledOnce()
		f.store()
		f.link.emit('connected')
		await toPromise(f.actor)
		expect(f.results).toHaveLength(1)
		expect(f.results[0]).toMatchObject({
			kind: 'available',
			text: draft.snapshot.text,
			asset: { kind: 'available' }
		})
		expect(f.capability[boundary]).toHaveBeenCalledTimes(2)
		expect(f.link.listeners.size).toBe(0)
	}
)
it.each(['offline', 'local-only', 'connecting'] as const)(
	'opens cached content without observing a %s connection',
	async (state) => {
		const link = connection(state)
		const actor = createActor(readRecordMachine, {
			input: {
				id: draft.document.id,
				capability: {
					isCurrent: () => true,
					observeConnection: link.observeConnection,
					document: async () => draft.document,
					snapshot: async () => draft.snapshot,
					asset: async () => draft.asset,
					source: async () => null
				}
			}
		}).start()
		expect(await toPromise(actor)).toEqual({ kind: 'available' })
		expect(link.observeConnection).not.toHaveBeenCalled()
	}
)
it.each(['offline', 'local-only', 'connected'] as const)(
	'finishes an absent read when the native connection resolves to %s',
	async (state) => {
		const f = fixture()
		await f.waiting()
		f.link.emit(state)
		await toPromise(f.actor)
		expect(f.results).toEqual([{ kind: 'unavailable' }])
		expect(f.capability.snapshot).toHaveBeenCalledTimes(state === 'connected' ? 2 : 1)
		expect(f.link.listeners.size).toBe(0)
		f.store()
		f.link.emit('connected')
		expect(f.results).toEqual([{ kind: 'unavailable' }])
	}
)
it('closes the query-to-listener race when connection completes before the miss is consumed', async () => {
	const f = fixture('document')
	// The first read already captured absence. Native readiness changes before
	// its promise completion admits the connection observer.
	f.store()
	f.link.emit('connected')
	await toPromise(f.actor)
	expect(f.results[0]).toMatchObject({ kind: 'available', text: draft.snapshot.text })
	expect(f.capability.document).toHaveBeenCalledTimes(2)
	expect(f.link.listeners.size).toBe(0)
})
it.each(['shutdown', 'stop', 'scope'] as const)(
	'releases the native listener and cannot resume private reads after %s',
	async (mode) => {
		const f = fixture()
		await f.waiting()
		f.store()
		if (mode === 'shutdown') f.actor.send({ type: 'SHUTDOWN' })
		if (mode === 'stop') f.actor.stop()
		if (mode === 'scope') f.loseScope()
		f.link.emit('connected')
		if (mode !== 'stop') await toPromise(f.actor)
		expect(f.link.listeners.size).toBe(0)
		expect(f.capability.snapshot).toHaveBeenCalledOnce()
		expect(f.results).toEqual(mode === 'stop' ? [] : [{ kind: 'unavailable' }])
	}
)
it('aborts an issued reread on shutdown and discards its late text', async () => {
	const f = fixture()
	await f.waiting()
	const pending = Promise.withResolvers<typeof draft.snapshot>()
	let signal: AbortSignal | undefined
	const entered = Promise.withResolvers<void>()
	f.capability.snapshot.mockImplementationOnce((_id, abort) => {
		signal = abort
		entered.resolve()
		return pending.promise
	})
	f.link.emit('connected')
	await entered.promise
	f.actor.send({ type: 'SHUTDOWN' })
	await toPromise(f.actor)
	expect(signal?.aborted).toBe(true)
	pending.resolve(draft.snapshot)
	await Promise.resolve()
	expect(f.results).toEqual([{ kind: 'unavailable' }])
	expect(f.link.listeners.size).toBe(0)
})
it.each(['document', 'snapshot', 'asset'] as const)(
	'preserves required and optional error handling for %s',
	async (boundary) => {
		const f = fixture(boundary)
		await f.waiting()
		f.capability[boundary].mockRejectedValueOnce(new Error('Read failed'))
		f.link.emit('connected')
		await toPromise(f.actor)
		expect(f.results[0]?.kind).toBe(boundary === 'asset' ? 'available' : 'unavailable')
		expect(f.link.listeners.size).toBe(0)
	}
)
