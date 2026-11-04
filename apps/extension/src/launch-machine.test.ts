import { expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import type { Capture } from './protocol.js'
import { createLaunchMachine } from './launch-machine.js'
const id = '77777777-7777-4777-8777-777777777777'
const url = 'https://example.com/article'
const capture = {
	version: 1 as const,
	id,
	tabId: 7,
	documentId: 'document',
	url,
	phase: 'ready' as const
}
function fixture(
	pending: Capture[] = [],
	inspect?: Promise<unknown>,
	deliver: () => Promise<boolean> = async () => true
) {
	const persisted = vi.fn(async () => {})
	const dispatch = vi.fn(deliver)
	const show = vi.fn(async () => {})
	const actor = createActor(
		createLaunchMachine({
			inspect: async () => inspect ?? { documentId: 'document', frameId: 0, result: url },
			pending: async () => pending,
			persist: persisted,
			dispatch,
			show,
			runtimeExists: async () => false,
			createRuntime: async () => {},
			reject: async () => {},
			id: () => id
		})
	).start()
	return { actor, persisted, dispatch, show }
}
it('persists a document-bound reference before dispatching to the hidden runtime', async () => {
	const f = fixture()
	f.actor.send({ type: 'CLIP', tab: { id: 7, url } })
	await waitFor(f.actor, (s) => s.matches('idle'))
	expect(f.persisted).toHaveBeenCalledWith(capture)
	expect(f.persisted.mock.invocationCallOrder[0]).toBeLessThan(
		f.dispatch.mock.invocationCallOrder[0]!
	)
	expect(f.dispatch).toHaveBeenCalledWith(id)
	f.actor.stop()
})
it('serializes launch ownership rather than issuing concurrent storage checks', async () => {
	const gate = Promise.withResolvers<unknown>()
	const f = fixture([], gate.promise)
	f.actor.send({ type: 'CLIP', tab: { id: 7, url } })
	f.actor.send({ type: 'CLIP', tab: { id: 8, url: 'https://example.com/other' } })
	gate.resolve({ documentId: 'document', frameId: 0, result: url })
	await waitFor(f.actor, (s) => s.matches('idle'))
	expect(f.persisted).toHaveBeenCalledOnce()
	expect(f.persisted).toHaveBeenCalledWith(capture)
	f.actor.stop()
})
it('refuses new work at the capacity bound without replaying an old reference', async () => {
	const pending = Array.from({ length: 8 }, (_, index) => ({
		...capture,
		id: `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`
	}))
	const f = fixture(pending)
	f.actor.send({ type: 'CLIP', tab: { id: 7, url } })
	await waitFor(f.actor, (s) => s.matches('idle'))
	expect(f.persisted).not.toHaveBeenCalled()
	expect(f.dispatch).not.toHaveBeenCalled()
	f.actor.stop()
})
it('does not persist another document after a navigation race', async () => {
	const f = fixture(
		[],
		Promise.resolve({ documentId: 'changed', frameId: 0, result: 'https://example.com/other' })
	)
	f.actor.send({ type: 'CLIP', tab: { id: 7, url } })
	await waitFor(f.actor, (s) => s.matches('idle'))
	expect(f.persisted).not.toHaveBeenCalled()
	expect(f.dispatch).not.toHaveBeenCalled()
	f.actor.stop()
})

it('does not replay an ambiguous runtime dispatch or claim that its native save failed', async () => {
	const f = fixture([], undefined, async () => {
		throw new Error('reply lost')
	})
	f.actor.send({ type: 'CLIP', tab: { id: 7, url } })
	await waitFor(f.actor, (s) => s.matches('idle'))
	expect(f.dispatch).toHaveBeenCalledOnce()
	expect(f.show).toHaveBeenLastCalledWith(capture, {
		text: expect.stringContaining('Save outcome is uncertain.'),
		variant: 'error'
	})
	f.actor.stop()
})
