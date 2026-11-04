import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { shellAssetMachine, shellReadMachine } from './asset.js'
it.each([true, false])(
	'stores a valid asset from the selected source (cache hit: %s)',
	async (hit) => {
		const response = new Response('asset'),
			fetch = vi.fn(async () => response),
			store = vi.fn(async () => {})
		const actor = createActor(shellAssetMachine, {
			input: { reuse: async () => (hit ? response : undefined), fetch, valid: () => true, store }
		}).start()
		expect(await toPromise(actor)).toBe('ready')
		expect(fetch).toHaveBeenCalledTimes(hit ? 0 : 1)
		expect(store).toHaveBeenCalledWith(response)
		expect(actor.getSnapshot().context.response).toBeUndefined()
	}
)
it('drains invalid response cancellation before failing and never writes it', async () => {
	const gate = Promise.withResolvers<void>(),
		cancelled = vi.fn(() => gate.promise),
		store = vi.fn(async () => {})
	const response = new Response(new ReadableStream({ cancel: cancelled }))
	const actor = createActor(shellAssetMachine, {
		input: { reuse: async () => undefined, fetch: async () => response, valid: () => false, store }
	}).start()
	await vi.waitFor(() => expect(cancelled).toHaveBeenCalledOnce())
	expect(actor.getSnapshot().status).toBe('active')
	expect(store).not.toHaveBeenCalled()
	gate.resolve()
	expect(await toPromise(actor)).toBe('failed')
})
it('reports store failure for the owning install machine to discard its partial cache', async () => {
	const actor = createActor(shellAssetMachine, {
		input: {
			reuse: async () => new Response('asset'),
			fetch: async () => {
				throw new Error('unexpected fetch')
			},
			valid: () => true,
			store: async () => {
				throw new Error('cache full')
			}
		}
	}).start()
	expect(await toPromise(actor)).toBe('failed')
})

it.each([true, false])(
	'runtime shell reads select cache or network without a store operation (hit: %s)',
	async (hit) => {
		const response = new Response('runtime'),
			fetch = vi.fn(async () => response)
		const result = await toPromise(
			createActor(shellReadMachine, {
				input: { cached: async () => (hit ? response : undefined), fetch }
			}).start()
		)
		expect(result.response).toBe(response)
		expect(fetch).toHaveBeenCalledTimes(hit ? 0 : 1)
	}
)
