import { expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import type { Capture } from './protocol.js'
import type { Authorization } from './connection.js'
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
	deliver: () => Promise<boolean> = async () => true,
	authorize: () => Promise<Authorization> = async () => 'connected'
) {
	const persisted = vi.fn(async () => {})
	const dispatch = vi.fn(deliver)
	const show = vi.fn(async () => {})
	const actor = createActor(
		createLaunchMachine({
			connection: async () => ({
				version: 1,
				confirmationId: id,
				accountId: id,
				appId: id,
				serverUrl: 'https://sync.test/'
			}),
			authorize,
			openSignIn: async () => 1,
			watchPopup: () => () => {},
			focusPopup: async () => {},
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
	expect(f.dispatch).toHaveBeenCalledWith(id, id)
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

it('opens one sign-in popup and saves nothing when it is canceled', async () => {
	let closed = () => {}
	const popup = vi.fn(async () => 9)
	const persist = vi.fn(async () => {})
	const inspect = vi.fn(async () => ({ documentId: 'document', frameId: 0, result: url }))
	const actor = createActor(
		createLaunchMachine({
			connection: async () => undefined,
			authorize: async () => 'signed-out',
			openSignIn: popup,
			watchPopup: (_id, notify) => {
				closed = notify
				return () => {}
			},
			focusPopup: async () => {},
			inspect,
			pending: async () => [],
			persist,
			show: async () => {},
			runtimeExists: async () => false,
			createRuntime: async () => {},
			dispatch: async () => true,
			reject: async () => {},
			id: () => id
		})
	).start()
	actor.send({ type: 'CLIP', tab: { id: 7, url } })
	await waitFor(actor, (s) => s.matches('waitingForSignIn'))
	actor.send({ type: 'CLIP', tab: { id: 7, url } })
	expect(popup).toHaveBeenCalledOnce()
	expect(popup).toHaveBeenCalledWith(id)
	expect(inspect).not.toHaveBeenCalled()
	expect(persist).not.toHaveBeenCalled()
	closed()
	await waitFor(actor, (s) => s.matches('idle'))
	expect(persist).not.toHaveBeenCalled()
	actor.stop()
})

it('waits for a cold offscreen listener before admitting capture without replaying a write', async () => {
	let attempts = 0
	const authorize = vi.fn(async () => {
		if (++attempts < 5) throw new Error('Receiving end does not exist yet')
		return 'connected' as const
	})
	const f = fixture([], undefined, async () => true, authorize)
	try {
		f.actor.send({ type: 'CLIP', tab: { id: 7, url } })
		await waitFor(f.actor, (snapshot) => snapshot.matches('idle'))
		expect(authorize).toHaveBeenCalledTimes(5)
		expect(f.persisted).toHaveBeenCalledOnce()
		expect(f.dispatch).toHaveBeenCalledOnce()
	} finally {
		f.actor.stop()
	}
})
