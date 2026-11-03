import { expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import { shellCacheMachine } from './cache.js'
function port() {
	return {
		populate: vi.fn(async () => {}),
		discard: vi.fn(async () => {}),
		obsolete: vi.fn(async () => ['old']),
		remove: vi.fn(async (_names: string[]) => {}),
		claim: vi.fn(async () => {})
	}
}
it('does not claim readiness until installation work settles', async () => {
	const gate = Promise.withResolvers<void>(),
		capability = port()
	capability.populate.mockImplementation(() => gate.promise)
	const actor = createActor(shellCacheMachine, {
		input: { mode: 'install', port: capability }
	}).start()
	expect(actor.getSnapshot().status).toBe('active')
	expect(capability.claim).not.toHaveBeenCalled()
	gate.resolve()
	expect(await toPromise(actor)).toBe('ready')
	expect(actor.getSnapshot().context.port).toBeUndefined()
})
it('waits for failed-install cleanup and leaves the old cache namespace alone', async () => {
	const gate = Promise.withResolvers<void>(),
		capability = port()
	capability.populate.mockRejectedValue(new Error('Quota'))
	capability.discard.mockImplementation(() => gate.promise)
	const actor = createActor(shellCacheMachine, {
		input: { mode: 'install', port: capability }
	}).start()
	await waitFor(actor, (s) => s.matches('discarding'))
	expect(actor.getSnapshot().status).toBe('active')
	expect(capability.remove).not.toHaveBeenCalled()
	gate.resolve()
	expect(await toPromise(actor)).toBe('failed')
	expect(capability.claim).not.toHaveBeenCalled()
	expect(actor.getSnapshot().context.port).toBeUndefined()
})
it('claims only after obsolete-cache cleanup settles', async () => {
	const gate = Promise.withResolvers<void>(),
		capability = port()
	capability.remove.mockImplementation(() => gate.promise)
	const actor = createActor(shellCacheMachine, {
		input: { mode: 'activate', port: capability }
	}).start()
	await waitFor(actor, (s) => s.matches('removing'))
	expect(capability.claim).not.toHaveBeenCalled()
	gate.resolve()
	expect(await toPromise(actor)).toBe('ready')
	expect(capability.remove).toHaveBeenCalledWith(['old'])
	expect(capability.claim).toHaveBeenCalledOnce()
})
it('keeps a usable installed build when obsolete-cache deletion fails', async () => {
	const capability = port()
	capability.remove.mockRejectedValue(new Error('Deletion unavailable'))
	const actor = createActor(shellCacheMachine, {
		input: { mode: 'activate', port: capability }
	}).start()
	expect(await toPromise(actor)).toBe('ready')
	expect(actor.getSnapshot().context.cleanupFailed).toBe(true)
	expect(capability.claim).toHaveBeenCalledOnce()
})
