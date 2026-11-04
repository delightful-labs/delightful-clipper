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
function fixture(pending: Capture[] = [], inspect?: Promise<unknown>) {
	const persisted = vi.fn(async () => {})
	const open = vi.fn(async () => {})
	const actor = createActor(
		createLaunchMachine({
			inspect: async () => inspect ?? { documentId: 'document', frameId: 0, result: url },
			pending: async () => pending,
			persist: persisted,
			open,
			id: () => id
		})
	).start()
	return { actor, persisted, open }
}
it('persists a document-bound reference before opening the trusted page', async () => {
	const f = fixture()
	f.actor.send({ type: 'CLIP', tab: { id: 7, url } })
	await waitFor(f.actor, (s) => s.matches('idle'))
	expect(f.persisted).toHaveBeenCalledWith(capture)
	expect(f.persisted.mock.invocationCallOrder[0]).toBeLessThan(f.open.mock.invocationCallOrder[0]!)
	expect(f.open).toHaveBeenCalledWith(id)
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
it('recovers existing pending work at the capacity bound without overwriting it', async () => {
	const pending = Array.from({ length: 8 }, (_, index) => ({
		...capture,
		id: `77777777-7777-4777-8777-${String(index).padStart(12, '0')}`
	}))
	const f = fixture(pending)
	f.actor.send({ type: 'CLIP', tab: { id: 7, url } })
	await waitFor(f.actor, (s) => s.matches('idle'))
	expect(f.persisted).not.toHaveBeenCalled()
	expect(f.open).toHaveBeenCalledWith(pending[0]!.id)
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
	expect(f.open).toHaveBeenCalledWith('')
	f.actor.stop()
})
