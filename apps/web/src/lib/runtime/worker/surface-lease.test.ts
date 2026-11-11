import { afterEach, expect, it, vi } from 'vitest'
import { createActor, createCallbackLogic, SimulatedClock, waitFor } from 'xstate'
import type { LibraryEvent } from '../../contracts/library.js'
import type { ReaderSurface } from '../../reader/surface.js'
import { readerSurfaceLeaseMachine } from './surface-lease.js'

const cleanups = new Set<() => void>()
afterEach(() => {
	for (const cleanup of cleanups) cleanup()
	cleanups.clear()
})
function fixture(offer = true) {
	const data = new MessageChannel(),
		clock = new SimulatedClock(),
		onOverdue = vi.fn()
	const commands: { type: string; id?: string }[] = [],
		surfaces: ReaderSurface[] = []
	data.port1.onmessage = (event) => commands.push(event.data)
	const library = createActor(
		createCallbackLogic<LibraryEvent>(({ receive }) => {
			receive((event) => {
				if (event.type === 'READER_EVENT' && event.event.type === 'ATTACH_SURFACE')
					surfaces.push(event.event.surface)
			})
		})
	).start()
	const actor = createActor(readerSurfaceLeaseMachine, {
		clock,
		input: {
			id: 'original-lease',
			port: data.port2,
			fullscreen: { supported: true, active: true },
			library: offer ? library : undefined,
			documentId: crypto.randomUUID(),
			sources: [],
			deadlineMs: 5,
			onOverdue
		}
	}).start()
	cleanups.add(() => {
		actor.stop()
		library.stop()
		data.port1.close()
	})
	const disposal = async () => {
		await vi.waitFor(() =>
			expect(commands.some((command) => command.type === 'DISPOSE')).toBe(true)
		)
		const id = commands.find((command) => command.type === 'DISPOSE')?.id
		if (!id) throw new Error('Missing native cleanup request')
		return id
	}
	return { actor, data, commands, clock, onOverdue, surfaces, disposal }
}
it('waits for reader release and actual Window cleanup before acknowledging the surface lease', async () => {
	const f = fixture()
	await vi.waitFor(() => expect(f.surfaces).toHaveLength(1))
	const surface = f.surfaces[0]
	if (!surface?.lifecycle) throw new Error('Missing reader lifecycle')
	surface.lifecycle.accepted()
	f.actor.send({ type: 'SHUTDOWN' })
	await vi.waitFor(() => expect(f.commands).toContainEqual({ type: 'DETACH' }))
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.commands.some((command) => command.type === 'DISPOSE')).toBe(false)
	// The reader reports this only after its final position/fullscreen/write join.
	surface.lifecycle.released()
	const id = await f.disposal()
	expect(f.actor.getSnapshot().status).toBe('active')
	f.data.port1.postMessage({ type: 'DISPOSED', id })
	await waitFor(f.actor, (s) => s.status === 'done', { timeout: 1000 })
	expect(f.actor.getSnapshot().output).toEqual({ id: 'original-lease' })
	expect(f.onOverdue).not.toHaveBeenCalled()
})
it('retains native cleanup past expiry and ignores a foreign cleanup receipt', async () => {
	const f = fixture(false),
		id = await f.disposal()
	f.clock.increment(5)
	expect(f.onOverdue).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().status).toBe('active')
	f.data.port1.postMessage({ type: 'DISPOSED', id: crypto.randomUUID() })
	await new Promise<void>((resolve) => setTimeout(resolve, 5))
	expect(f.actor.getSnapshot().status).toBe('active')
	f.data.port1.postMessage({ type: 'DISPOSED', id })
	await waitFor(f.actor, (s) => s.status === 'done', { timeout: 1000 })
})
it('closes a refused attachment before any reader offer and does not fake native cleanup on stop', async () => {
	const f = fixture(false)
	await f.disposal()
	expect(f.surfaces).toHaveLength(0)
	f.actor.stop()
	expect(f.actor.getSnapshot().output).toBeUndefined()
})
it('retains a reader that never acknowledges release and requests detach only once', async () => {
	const f = fixture()
	await vi.waitFor(() => expect(f.surfaces).toHaveLength(1))
	f.surfaces[0]?.lifecycle?.accepted()
	f.actor.send({ type: 'SHUTDOWN' })
	f.actor.send({ type: 'SHUTDOWN' })
	f.clock.increment(5)
	await vi.waitFor(() => expect(f.commands).toEqual([{ type: 'DETACH' }]))
	expect(f.onOverdue).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.actor.getSnapshot().output).toBeUndefined()
})
