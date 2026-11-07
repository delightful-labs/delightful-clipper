import { createActor, waitFor } from 'xstate'
import { expect, it, vi } from 'vitest'
import { rootBootstrapMachine } from './root-bootstrap.js'

it('drains a write when shutdown arrives between issue and its receipt handoff', async () => {
	const pending = Promise.withResolvers<void>()
	const local = vi.fn(() => pending.promise)
	const ensure = vi.fn(() => ({ local, global: async () => {} }))
	const actor = createActor(rootBootstrapMachine, {
		input: { read: async () => 'missing', ensure }
	})
	actor.subscribe((snapshot) => {
		if (snapshot.matches({ writing: { operation: 'issuing', lifetime: 'active' } }))
			actor.send({ type: 'SHUTDOWN' })
	})
	actor.start()
	await vi.waitFor(() => expect(local).toHaveBeenCalledOnce())
	expect(ensure).toHaveBeenCalledOnce()
	expect(actor.getSnapshot().status).toBe('active')
	pending.resolve()
	await waitFor(actor, (snapshot) => snapshot.status === 'done')
	expect(actor.getSnapshot().output).toEqual({ outcome: 'closed' })
})

it('does not issue a write when shutdown interrupts the initial read', async () => {
	const pending = Promise.withResolvers<'compatible'>()
	const ensure = vi.fn(() => ({ local: async () => {}, global: async () => {} }))
	const actor = createActor(rootBootstrapMachine, {
		input: { read: () => pending.promise, ensure }
	}).start()
	actor.send({ type: 'SHUTDOWN' })
	pending.resolve('compatible')
	await waitFor(actor, (snapshot) => snapshot.status === 'done')
	expect(ensure).not.toHaveBeenCalled()
	expect(actor.getSnapshot().output).toEqual({ outcome: 'closed' })
})

it('opens a compatible persisted library without issuing or waiting for a write', async () => {
	const ensure = vi.fn(() => {
		throw new Error('Unexpected startup write')
	})
	const actor = createActor(rootBootstrapMachine, {
		input: { read: async () => 'compatible', ensure }
	}).start()
	await waitFor(actor, (s) => s.status === 'done')
	expect(actor.getSnapshot().output).toEqual({ outcome: 'ready' })
	expect(ensure).not.toHaveBeenCalled()
})
