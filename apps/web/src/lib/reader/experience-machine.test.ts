import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor, SimulatedClock } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { readerExperienceMachine, selectReaderExperience } from '../machines/reader/experience.js'
import type { ReaderChange, ReaderOperation, ReadingPosition } from './schema.js'
import { readerOperationSchema } from './schema.js'
import type { SyncReceipt } from '../contracts/storage.js'
import type { ReaderCapability } from '../contracts/reader.js'
import {
	viewportDOM,
	installViewportDOM,
	closeViewportDOMs,
	TestResizeObserver
} from './viewport.test-support.js'
beforeEach(installViewportDOM)
const documentId = crypto.randomUUID(),
	libraryId = crypto.randomUUID()
const position = (offset = 10): ReadingPosition => ({
	version: 1,
	offset,
	quote: 'read',
	prefix: '',
	suffix: '',
	progress: offset / 100,
	interactedAt: new Date().toISOString()
})
function serveViewportPeer(
	port: MessagePort,
	command: (type: string, settle: (position: ReadingPosition) => void) => void
) {
	let attachmentId: string
	port.onmessage = ({ data }) => {
		if (data.type === 'VIEWPORT_OPEN') {
			attachmentId = data.attachmentId
			port.postMessage({ type: 'VIEWPORT_OPENED', attachmentId })
		}
		command(data.type, (position) =>
			port.postMessage({ type: 'VIEWPORT_SETTLED', attachmentId, outcome: 'closed', position })
		)
	}
}
function fixture(local = async () => {}, global = async () => {}, clock?: SimulatedClock) {
	let current = true
	const writes: ReaderChange[] = [],
		dispose = vi.fn()
	const received: { change: ReaderChange; operationId: string; observed: ReaderOperation[] }[] = []
	const stage = (observed: ReaderOperation[]) =>
		createWorkspaceCreationTransaction<ReaderChange, object, null, SyncReceipt, object>({
			retainDetached: vi.fn(),
			open: () => ({}),
			readLocal: async (_resource, attempt) => {
				received.push({ change: attempt.draft, operationId: attempt.operationId, observed })
				return null
			},
			assess: () => ({ outcome: 'eligible' }),
			stage: (_resource, attempt) => {
				writes.push(attempt.draft)
				return { global }
			},
			commit: () => ({}),
			persistLocal: local,
			rollback: () => true
		})
	const capability: ReaderCapability = {
		isCurrent: () => current,
		subscribe: (next) => {
			next([])
			return dispose
		},
		spawnWrite: (spawn, draft, operationId, observed) =>
			spawn(stage(observed), {
				input: {
					attempt: { operationId, workspaceId: operationId, membershipId: operationId, draft }
				}
			})
	}
	const actor = createActor(readerExperienceMachine, {
		input: {
			capability,
			viewportReplyTimeoutMs: clock ? 5 : 10_000,
			...(clock ? { now: () => clock.now() } : {})
		},
		...(clock ? { clock } : {})
	}).start()
	return { actor, writes, received, dispose, expire: () => (current = false) }
}
afterEach(() => {
	closeViewportDOMs()
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

it.each(['open', 'detach', 'messageerror', 'post', 'peer'] as const)(
	'retains the original surface and rejects stale cleanup after %s failure',
	async (failure) => {
		const clock = new SimulatedClock(),
			f = fixture(undefined, undefined, clock)
		const channel = new MessageChannel(),
			released = vi.fn()
		let attachmentId = ''
		const surface = {
			viewport: { port: channel.port2 },
			fullscreen: {
				supported: () => false,
				active: () => false,
				enter: async () => {},
				exit: async () => {},
				observe: () => () => {}
			},
			lifecycle: { accepted: vi.fn(), released }
		}
		channel.port1.onmessage = ({ data }) => {
			if (data.type === 'VIEWPORT_OPEN') {
				attachmentId = data.attachmentId
				if (failure !== 'open') channel.port1.postMessage({ type: 'VIEWPORT_OPENED', attachmentId })
			}
		}
		const refused =
			failure === 'post'
				? vi.spyOn(channel.port2, 'postMessage').mockImplementation(() => {
						throw new Error('Port refused')
					})
				: undefined
		try {
			f.actor.send({ type: 'ATTACH_SURFACE', surface, documentId, sources: [] })
			if (failure === 'post') attachmentId = f.actor.getSnapshot().context.attachment!.id
			else await vi.waitFor(() => expect(attachmentId).not.toBe(''))
			if (failure === 'open') clock.increment(5)
			else if (failure !== 'post') {
				await vi.waitFor(() =>
					expect(
						f.actor.getSnapshot().children.viewport?.getSnapshot().matches({ remote: 'active' })
					).toBe(true)
				)
				// A standing open viewport does not expire.
				clock.increment(50_000)
				expect(f.actor.getSnapshot().matches({ active: { viewport: { owning: 'active' } } })).toBe(
					true
				)
				if (failure === 'detach') {
					f.actor.send({ type: 'DETACH' })
					clock.increment(5)
				}
				if (failure === 'messageerror')
					channel.port2.dispatchEvent(new MessageEvent('messageerror'))
				if (failure === 'peer') channel.port1.postMessage({ type: 'VIEWPORT_FAILED', attachmentId })
			}
			await vi.waitFor(() =>
				expect(
					f.actor.getSnapshot().matches({
						active: {
							viewport: {
								owning: failure === 'open' || failure === 'detach' ? 'overdue' : 'unavailable'
							}
						}
					})
				).toBe(true)
			)
			expect(selectReaderExperience(f.actor.getSnapshot()).message?.variant).toBe('error')
			f.expire()
			f.actor.send({ type: 'SHUTDOWN' })
			expect(f.actor.getSnapshot().status).toBe('active')
			expect(released).not.toHaveBeenCalled()
			const received = vi.fn()
			channel.port2.addEventListener('message', received)
			channel.port1.postMessage({
				type: 'VIEWPORT_SETTLED',
				attachmentId: crypto.randomUUID(),
				outcome: 'closed',
				position: position(99)
			})
			await vi.waitFor(() => expect(received).toHaveBeenCalledOnce())
			expect(released).not.toHaveBeenCalled()
			expect(f.actor.getSnapshot().status).toBe('active')
			refused?.mockRestore()
			channel.port1.postMessage({
				type: 'VIEWPORT_SETTLED',
				attachmentId,
				outcome: 'closed',
				position: position(99)
			})
			await toPromise(f.actor)
			expect(released).toHaveBeenCalledOnce()
			expect(f.writes).toEqual([])
		} finally {
			refused?.mockRestore()
			f.actor.stop()
			channel.port1.close()
			channel.port2.close()
		}
	}
)

it('retains the last confirmed position write through overdue detach and discards the late final position', async () => {
	const clock = new SimulatedClock(),
		persisted = Promise.withResolvers<void>()
	const f = fixture(() => persisted.promise, undefined, clock),
		channel = new MessageChannel(),
		released = vi.fn()
	const surface = {
		viewport: { port: channel.port2 },
		fullscreen: {
			supported: () => false,
			active: () => false,
			enter: async () => {},
			exit: async () => {},
			observe: () => () => {}
		},
		lifecycle: { accepted: vi.fn(), released }
	}
	const measured = position(40)
	let attachmentId = ''
	channel.port1.onmessage = ({ data }) => {
		if (data.type === 'VIEWPORT_OPEN') {
			attachmentId = data.attachmentId
			channel.port1.postMessage({ type: 'VIEWPORT_OPENED', attachmentId })
		}
	}
	try {
		f.actor.send({ type: 'ATTACH_SURFACE', surface, documentId, sources: [] })
		await vi.waitFor(() =>
			expect(
				f.actor.getSnapshot().children.viewport?.getSnapshot().matches({ remote: 'active' })
			).toBe(true)
		)
		channel.port1.postMessage({ type: 'MEASURE', attachmentId, position: measured })
		await vi.waitFor(() => expect(f.actor.getSnapshot().context.queue).toHaveLength(1))
		clock.increment(1000)
		await vi.waitFor(() => expect(f.writes).toHaveLength(1))
		f.actor.send({ type: 'DETACH' })
		clock.increment(5)
		f.actor.send({ type: 'SHUTDOWN' })
		channel.port1.postMessage({
			type: 'VIEWPORT_SETTLED',
			attachmentId,
			outcome: 'closed',
			position: position(99)
		})
		await vi.waitFor(() =>
			expect(f.actor.getSnapshot().matches({ active: { viewport: 'detached' } })).toBe(true)
		)
		expect(released).not.toHaveBeenCalled()
		expect(f.actor.getSnapshot().status).toBe('active')
		expect(f.writes).toEqual([{ documentId, field: 'position', value: measured }])
		persisted.resolve()
		await toPromise(f.actor)
		expect(released).toHaveBeenCalledOnce()
		expect(f.writes).toHaveLength(1)
	} finally {
		persisted.resolve()
		f.actor.stop()
		channel.port1.close()
		channel.port2.close()
	}
})
it('passes exact issued changes and per-write observed rows to native children while draining queued edits', async () => {
	const entered = Promise.withResolvers<void>()
	const release = Promise.withResolvers<void>()
	const { actor, received } = fixture(async () => {
		entered.resolve()
		await release.promise
	})
	const row = (value: string) =>
		readerOperationSchema.parse({
			id: crypto.randomUUID(),
			libraryId,
			documentId: null,
			field: 'size',
			value,
			parents: '[]'
		})
	const firstRows = [row('20')],
		nextRows = [row('22')]
	const first: ReaderChange = { field: 'theme', documentId: null, value: 'dark' }
	const next: ReaderChange = { field: 'size', documentId: null, value: 28 }
	actor.send({ type: 'ROWS', rows: firstRows })
	actor.send({ type: 'CHANGE', change: first })
	await entered.promise
	actor.send({ type: 'CHANGE', change: next })
	actor.send({ type: 'ROWS', rows: nextRows })
	actor.send({ type: 'SHUTDOWN' })
	actor.send({ type: 'SHUTDOWN' })
	expect(received).toHaveLength(1)
	expect(received[0]!.change).toBe(first)
	expect(received[0]!.observed).toBe(firstRows)
	release.resolve()
	await toPromise(actor)
	expect(received).toHaveLength(2)
	expect(received[1]!.change).toBe(next)
	expect(received[1]!.observed).toBe(nextRows)
	expect(new Set(received.map((input) => input.operationId)).size).toBe(2)
	for (const input of received) expect(input.operationId).toMatch(/^[0-9a-f-]{36}$/)
})
it('saves independent desired fields and rejects invalid commands while retaining native-authoritative projection', async () => {
	const { actor, writes } = fixture()
	actor.send({ type: 'CHANGE', change: { field: 'size', documentId: null, value: 24 } })
	await waitFor(actor, (snapshot) => snapshot.matches({ active: { writer: 'idle' } }))
	expect(writes).toEqual([{ field: 'size', documentId: null, value: 24 }])
	actor.send({
		type: 'ROWS',
		rows: [
			readerOperationSchema.parse({
				id: crypto.randomUUID(),
				libraryId,
				documentId: null,
				field: 'size',
				value: '24',
				parents: '[]'
			})
		]
	})
	expect(selectReaderExperience(actor.getSnapshot()).preferences.size).toBe(24)
	actor.send({ type: 'CHANGE', change: { field: 'size', documentId: null, value: 99 } })
	expect(writes).toHaveLength(1)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('coalesces unissued positions and flushes the latest accepted position on departure', async () => {
	vi.useFakeTimers()
	const { actor, writes } = fixture()
	actor.send({ type: 'CHANGE', change: { field: 'position', documentId, value: position(10) } })
	await vi.advanceTimersByTimeAsync(700)
	actor.send({ type: 'CHANGE', change: { field: 'position', documentId, value: position(30) } })
	await vi.advanceTimersByTimeAsync(700)
	expect(writes).toEqual([])
	actor.send({ type: 'DETACH' })
	await vi.advanceTimersByTimeAsync(0)
	expect(writes).toEqual(
		[{ field: 'position', documentId, value: position(30) }].map((change) => ({
			...change,
			value: expect.objectContaining({ offset: 30 })
		}))
	)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('drains an issued native write, flushes accepted queued work and immediately disposes observations on shutdown', async () => {
	const entered = Promise.withResolvers<void>(),
		held = Promise.withResolvers<void>()
	const { actor, writes, dispose } = fixture(async () => {
		entered.resolve()
		await held.promise
	})
	actor.send({ type: 'CHANGE', change: { field: 'theme', documentId: null, value: 'dark' } })
	await entered.promise
	actor.send({ type: 'CHANGE', change: { field: 'size', documentId: null, value: 26 } })
	actor.send({ type: 'SHUTDOWN' })
	expect(dispose).toHaveBeenCalledOnce()
	expect(actor.getSnapshot().status).toBe('active')
	held.resolve()
	await toPromise(actor)
	expect(writes.map((write) => write.field)).toEqual(['theme', 'size'])
	expect(actor.getSnapshot().context.rows).toEqual([])
	expect(actor.getSnapshot().context.capability).toBeUndefined()
})
it('does not replay an uncertain write or admit automatic position writes until the reader is reopened', async () => {
	const { actor, writes } = fixture(async () => {
		throw new Error('Unknown local settlement')
	})
	actor.send({ type: 'CHANGE', change: { field: 'theme', documentId: null, value: 'dark' } })
	await waitFor(actor, (snapshot) => snapshot.matches({ active: { writer: 'uncertain' } }))
	actor.send({ type: 'CHANGE', change: { field: 'theme', documentId: null, value: 'dark' } })
	expect(writes).toHaveLength(1)
	expect(selectReaderExperience(actor.getSnapshot()).enabled).toBe(false)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('discards unissued scoped work and hides old preferences when the native binding expires during drain', async () => {
	const entered = Promise.withResolvers<void>(),
		held = Promise.withResolvers<void>()
	const { actor, writes, expire } = fixture(async () => {
		entered.resolve()
		await held.promise
	})
	actor.send({ type: 'CHANGE', change: { field: 'theme', documentId: null, value: 'dark' } })
	await entered.promise
	actor.send({ type: 'CHANGE', change: { field: 'size', documentId: null, value: 26 } })
	expire()
	expect(selectReaderExperience(actor.getSnapshot()).preferences.theme).toBe('system')
	actor.send({ type: 'SHUTDOWN' })
	held.resolve()
	await toPromise(actor)
	expect(writes).toHaveLength(1)
})
it('restores once, ignores late remote positions, preserves the current anchor on resize and rejects disposed viewport reports', async () => {
	vi.useFakeTimers()
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
		setTimeout(() => callback(0), 1)
	)
	vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
	const { actor, writes } = fixture(),
		dom = viewportDOM()
	const first = dom.position(10),
		remote = dom.position(70)
	const row = (value: ReadingPosition): ReaderOperation =>
		readerOperationSchema.parse({
			id: crypto.randomUUID(),
			libraryId,
			documentId,
			field: 'position',
			value: JSON.stringify(value),
			parents: '[]'
		})
	actor.send({ type: 'ROWS', rows: [row(first)] })
	actor.send({ type: 'ATTACH', documentId, root: dom.root, scroller: dom.scroller })
	await vi.advanceTimersByTimeAsync(3)
	expect(dom.scroller.scrollTop).toBe(10)
	dom.scroll(0)
	await vi.advanceTimersByTimeAsync(1)
	expect(writes).toEqual([])
	actor.send({ type: 'ROWS', rows: [row(remote)] })
	expect(dom.scroller.scrollTop).toBe(0)
	dom.interact()
	dom.scroll(30)
	await vi.advanceTimersByTimeAsync(1)
	dom.resize(700)
	await vi.advanceTimersByTimeAsync(3)
	expect(dom.scroller.scrollTop).toBe(30)
	dom.interact()
	actor.send({ type: 'DETACH' })
	await vi.advanceTimersByTimeAsync(0)
	expect(TestResizeObserver.instances[0]?.disconnect).toHaveBeenCalledOnce()
	const before = writes.length
	dom.scroll(80)
	await vi.advanceTimersByTimeAsync(1500)
	expect(writes.length).toBe(before)
	expect(writes.at(-1)).toMatchObject({ value: { offset: 30 } })
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})

it('shows progress before persistence and retains the furthest point when scrolling back within the debounce interval', async () => {
	vi.useFakeTimers()
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
		setTimeout(() => callback(0), 1)
	)
	vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
	const { actor, writes, expire } = fixture(),
		dom = viewportDOM()
	actor.send({ type: 'ATTACH', documentId, root: dom.root, scroller: dom.scroller })
	await vi.advanceTimersByTimeAsync(3)
	dom.interact()
	dom.scroll(60)
	await vi.advanceTimersByTimeAsync(1)
	expect(selectReaderExperience(actor.getSnapshot()).progress[documentId]).toBe(0.6)
	await vi.advanceTimersByTimeAsync(500)
	dom.scroll(30)
	await vi.advanceTimersByTimeAsync(1)
	await vi.advanceTimersByTimeAsync(500)
	dom.scroll(40)
	await vi.advanceTimersByTimeAsync(1)
	expect(writes).toEqual([])
	expect(selectReaderExperience(actor.getSnapshot()).progress[documentId]).toBe(0.6)
	await vi.advanceTimersByTimeAsync(1000)
	expect(writes.at(-1)).toMatchObject({ field: 'position', value: { offset: 40, progress: 0.6 } })
	expire()
	expect(selectReaderExperience(actor.getSnapshot()).progress).toEqual({})
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})

it('does not flush a new automatic position on departure after an uncertain write', async () => {
	vi.useFakeTimers()
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
		setTimeout(() => callback(0), 1)
	)
	vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
	const { actor, writes } = fixture(async () => {
			throw new Error('Unknown settlement')
		}),
		dom = viewportDOM()
	actor.send({ type: 'ATTACH', documentId, root: dom.root, scroller: dom.scroller })
	await vi.advanceTimersByTimeAsync(3)
	dom.interact()
	dom.scroll(30)
	await vi.advanceTimersByTimeAsync(1001)
	expect(selectReaderExperience(actor.getSnapshot()).enabled).toBe(false)
	dom.scroll(60)
	actor.send({ type: 'DETACH' })
	await vi.advanceTimersByTimeAsync(1000)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
	expect(writes).toHaveLength(1)
})

it('models subscription failure without allowing writes and disposes the failed observation', async () => {
	const { actor, dispose, writes } = fixture()
	actor.send({ type: 'OBSERVATION_FAILED' })
	actor.send({ type: 'CHANGE', change: { documentId: null, field: 'theme', value: 'dark' } })
	expect(selectReaderExperience(actor.getSnapshot()).enabled).toBe(false)
	expect(dispose).toHaveBeenCalledOnce()
	expect(writes).toEqual([])
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('retains remote rejection after a later independent field succeeds', async () => {
	const rejected = Promise.withResolvers<void>(),
		accepted = Promise.withResolvers<void>()
	let index = 0
	const { actor } = fixture(
		async () => {},
		() => (++index === 1 ? rejected.promise : accepted.promise)
	)
	actor.send({ type: 'CHANGE', change: { documentId: null, field: 'theme', value: 'dark' } })
	await waitFor(actor, (snapshot) => snapshot.matches({ active: { writer: 'idle' } }))
	actor.send({ type: 'CHANGE', change: { documentId: null, field: 'size', value: 28 } })
	await waitFor(actor, (snapshot) => snapshot.matches({ active: { writer: 'idle' } }))
	rejected.reject(new Error('Remote rejection'))
	accepted.resolve()
	await waitFor(actor, (snapshot) => snapshot.matches({ active: { synchronization: 'failed' } }))
	expect(selectReaderExperience(actor.getSnapshot()).message?.variant).toBe('error')
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('drains a pending fullscreen request and exit before shutdown completes', async () => {
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
		setTimeout(() => callback(0), 1)
	)
	vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
	const entered = Promise.withResolvers<void>(),
		exited = Promise.withResolvers<void>()
	const { actor } = fixture(),
		dom = viewportDOM()
	dom.enter.mockImplementation(async () => {
		await entered.promise
		dom.setFullscreen(true)
	})
	dom.exit.mockImplementation(async () => {
		await exited.promise
		dom.setFullscreen(false)
	})
	const remove = vi.spyOn(dom.document, 'removeEventListener')
	actor.send({ type: 'ATTACH', documentId, root: dom.root, scroller: dom.scroller })
	actor.send({ type: 'FOCUS' })
	expect(dom.enter).toHaveBeenCalledOnce()
	expect(selectReaderExperience(actor.getSnapshot()).focused).toBe(true)
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().status).toBe('active')
	entered.resolve()
	await waitFor(actor, (snapshot) =>
		snapshot.matches({ active: { focus: { focused: { native: 'exiting' } } } })
	)
	expect(dom.exit).toHaveBeenCalledOnce()
	exited.resolve()
	await toPromise(actor)
	expect(remove).toHaveBeenCalledWith('fullscreenchange', expect.any(Function))
})

it('uses distraction-free fallback when fullscreen is declined and responds to a native fullscreen exit', async () => {
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
		setTimeout(() => callback(0), 1)
	)
	vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
	const { actor } = fixture(),
		dom = viewportDOM()
	dom.enter.mockImplementationOnce(async () => {
		throw new Error('Browser declined fullscreen')
	})
	actor.send({ type: 'ATTACH', documentId, root: dom.root, scroller: dom.scroller })
	actor.send({ type: 'FOCUS' })
	await waitFor(actor, (snapshot) =>
		snapshot.matches({ active: { focus: { focused: 'fallback' } } })
	)
	expect(selectReaderExperience(actor.getSnapshot()).focused).toBe(true)
	actor.send({ type: 'SHOW_CONTROLS' })
	expect(selectReaderExperience(actor.getSnapshot()).focused).toBe(false)
	actor.send({ type: 'FOCUS' })
	await waitFor(actor, (snapshot) =>
		snapshot.matches({ active: { focus: { focused: { native: 'fullscreen' } } } })
	)
	dom.setFullscreen(false)
	expect(selectReaderExperience(actor.getSnapshot()).focused).toBe(false)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})

it('uses a guarded fallback for unsupported or unconfirmed fullscreen without issuing exit', async () => {
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
		setTimeout(() => callback(0), 1)
	)
	vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
	const { actor } = fixture(),
		dom = viewportDOM()
	Object.defineProperty(dom.document, 'fullscreenEnabled', { value: false, configurable: true })
	actor.send({ type: 'ATTACH', documentId, root: dom.root, scroller: dom.scroller })
	actor.send({ type: 'FOCUS' })
	expect(actor.getSnapshot().matches({ active: { focus: { focused: 'fallback' } } })).toBe(true)
	expect(dom.enter).not.toHaveBeenCalled()
	actor.send({ type: 'SHOW_CONTROLS' })
	Object.defineProperty(dom.document, 'fullscreenEnabled', { value: true, configurable: true })
	dom.enter.mockImplementationOnce(async () => {})
	actor.send({ type: 'FOCUS' })
	await waitFor(actor, (snapshot) =>
		snapshot.matches({ active: { focus: { focused: 'fallback' } } })
	)
	actor.send({ type: 'SHOW_CONTROLS' })
	expect(dom.exit).not.toHaveBeenCalled()
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('ignores active native change events and checks actual fullscreen before requesting exit', async () => {
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
		setTimeout(() => callback(0), 1)
	)
	vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
	const { actor } = fixture(),
		dom = viewportDOM()
	actor.send({ type: 'ATTACH', documentId, root: dom.root, scroller: dom.scroller })
	actor.send({ type: 'FOCUS' })
	await waitFor(actor, (snapshot) =>
		snapshot.matches({ active: { focus: { focused: { native: 'fullscreen' } } } })
	)
	dom.setFullscreen(true)
	expect(selectReaderExperience(actor.getSnapshot()).focused).toBe(true)
	Object.defineProperty(dom.document, 'fullscreenElement', { value: null, configurable: true })
	actor.send({ type: 'SHOW_CONTROLS' })
	expect(selectReaderExperience(actor.getSnapshot()).focused).toBe(false)
	expect(dom.exit).not.toHaveBeenCalled()
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})

it('does not issue fullscreen entry when native observation setup fails', async () => {
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
		setTimeout(() => callback(0), 1)
	)
	vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
	const { actor } = fixture(),
		dom = viewportDOM()
	const add = dom.document.addEventListener.bind(dom.document)
	vi.spyOn(dom.document, 'addEventListener').mockImplementation((name, listener, options) => {
		if (name === 'fullscreenchange') throw new Error('Listener unavailable')
		add(name, listener, options)
	})
	actor.send({ type: 'ATTACH', documentId, root: dom.root, scroller: dom.scroller })
	actor.send({ type: 'FOCUS' })
	expect(actor.getSnapshot().matches({ active: { focus: { focused: 'fallback' } } })).toBe(true)
	expect(dom.enter).not.toHaveBeenCalled()
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})

it('reports surface release only after the final position write and fullscreen exit settle', async () => {
	const persisted = Promise.withResolvers<void>(),
		exit = Promise.withResolvers<void>()
	const f = fixture(() => persisted.promise)
	const port = new MessageChannel(),
		accepted = vi.fn(),
		released = vi.fn()
	const fullscreen = {
		supported: () => true,
		active: () => true,
		enter: async () => {},
		exit: vi.fn(() => exit.promise),
		observe: () => () => {}
	}
	const surface = { viewport: { port: port.port2 }, fullscreen, lifecycle: { accepted, released } }
	const commands: string[] = []
	serveViewportPeer(port.port1, (type, settle) => {
		commands.push(type)
		if (type === 'DETACH') settle(position(40))
	})
	try {
		f.actor.send({ type: 'ATTACH_SURFACE', surface, documentId, sources: [] })
		await vi.waitFor(() => expect(commands).toContain('VIEWPORT_OPEN'))
		f.actor.send({ type: 'FOCUS' })
		await vi.waitFor(() =>
			expect(
				f.actor.getSnapshot().matches({ active: { focus: { focused: { native: 'fullscreen' } } } })
			).toBe(true)
		)
		f.actor.send({ type: 'SHUTDOWN' })
		await vi.waitFor(() => expect(f.writes.some((write) => write.field === 'position')).toBe(true))
		expect(accepted).toHaveBeenCalledOnce()
		expect(released).not.toHaveBeenCalled()
		persisted.resolve()
		await vi.waitFor(() => expect(fullscreen.exit).toHaveBeenCalledOnce())
		expect(released).not.toHaveBeenCalled()
		exit.resolve()
		await waitFor(f.actor, (s) => s.status === 'done', { timeout: 1000 })
		expect(released).toHaveBeenCalledOnce()
	} finally {
		persisted.resolve()
		exit.resolve()
		f.actor.stop()
		port.port1.close()
		port.port2.close()
	}
})

it.each(['DETACH', 'SHUTDOWN'] as const)(
	'retires a pending replacement on %s without reopening it or dropping the original final write',
	async (type) => {
		const persisted = Promise.withResolvers<void>(),
			detached = Promise.withResolvers<void>()
		const f = fixture(() => persisted.promise),
			a = new MessageChannel(),
			b = new MessageChannel()
		const releasedA = vi.fn(),
			releasedB = vi.fn(),
			openedB = vi.fn(),
			commands: string[] = []
		const fullscreen = {
			supported: () => false,
			active: () => false,
			enter: async () => {},
			exit: async () => {},
			observe: () => () => {}
		}
		const surface = (port: MessagePort, released: () => void) => ({
			viewport: { port },
			fullscreen,
			lifecycle: { accepted: vi.fn(), released }
		})
		serveViewportPeer(a.port1, (type, settle) => {
			commands.push(type)
			if (type === 'DETACH') void detached.promise.then(() => settle(position(45)))
		})
		b.port1.onmessage = openedB
		try {
			f.actor.send({
				type: 'ATTACH_SURFACE',
				surface: surface(a.port2, releasedA),
				documentId,
				sources: []
			})
			await vi.waitFor(() => expect(commands).toContain('VIEWPORT_OPEN'))
			f.actor.send({
				type: 'ATTACH_SURFACE',
				surface: surface(b.port2, releasedB),
				documentId: crypto.randomUUID(),
				sources: []
			})
			await vi.waitFor(() => expect(commands).toContain('DETACH'))
			f.actor.send({ type })
			expect(f.actor.getSnapshot().status).toBe('active')
			expect(releasedA).not.toHaveBeenCalled()
			detached.resolve()
			await vi.waitFor(() =>
				expect(f.writes).toContainEqual({
					field: 'position',
					documentId,
					value: expect.objectContaining({ offset: 45 })
				})
			)
			expect(releasedA).not.toHaveBeenCalled()
			expect(f.actor.getSnapshot().status).toBe('active')
			persisted.resolve()
			await vi.waitFor(() => expect(releasedA).toHaveBeenCalledOnce())
			expect(releasedB).toHaveBeenCalledOnce()
			f.actor.send({ type: 'SHUTDOWN' })
			await waitFor(f.actor, (snapshot) => snapshot.status === 'done', { timeout: 1000 })
			expect(releasedA).toHaveBeenCalledOnce()
			expect(releasedB).toHaveBeenCalledOnce()
			expect(openedB).not.toHaveBeenCalled()
			expect(commands.filter((command) => command === 'DETACH')).toHaveLength(1)
		} finally {
			detached.resolve()
			persisted.resolve()
			f.actor.stop()
			a.port1.close()
			a.port2.close()
			b.port1.close()
			b.port2.close()
		}
	}
)

it('queues a replacement surface while the old viewport closes and releases each original lease after its own work', async () => {
	const persisted = Promise.withResolvers<void>(),
		detached = Promise.withResolvers<void>()
	const f = fixture(() => persisted.promise),
		a = new MessageChannel(),
		b = new MessageChannel()
	const releasedA = vi.fn(),
		releasedB = vi.fn(),
		nextId = crypto.randomUUID()
	const fullscreen = {
		supported: () => false,
		active: () => false,
		enter: async () => {},
		exit: async () => {},
		observe: () => () => {}
	}
	const make = (port: MessagePort, released: () => void) => ({
		viewport: { port },
		fullscreen,
		lifecycle: { accepted: vi.fn(), released }
	})
	const first = make(a.port2, releasedA),
		next = make(b.port2, releasedB),
		opened = vi.fn()
	serveViewportPeer(a.port1, (type, settle) => {
		if (type === 'VIEWPORT_OPEN') opened('A')
		if (type === 'DETACH') void detached.promise.then(() => settle(position(30)))
	})
	serveViewportPeer(b.port1, (type, settle) => {
		if (type === 'VIEWPORT_OPEN') opened('B')
		if (type === 'DETACH') settle(position(60))
	})
	try {
		f.actor.send({ type: 'ATTACH_SURFACE', surface: first, documentId, sources: [] })
		await vi.waitFor(() => expect(opened).toHaveBeenCalledWith('A'))
		f.actor.send({ type: 'ATTACH_SURFACE', surface: next, documentId: nextId, sources: [] })
		expect(releasedA).not.toHaveBeenCalled()
		expect(releasedB).not.toHaveBeenCalled()
		detached.resolve()
		await vi.waitFor(() => expect(opened).toHaveBeenCalledWith('B'))
		await vi.waitFor(() =>
			expect(
				f.writes.some((write) => write.field === 'position' && write.documentId === documentId)
			).toBe(true)
		)
		expect(releasedA).not.toHaveBeenCalled()
		persisted.resolve()
		await vi.waitFor(() => expect(releasedA).toHaveBeenCalledOnce())
		expect(releasedB).not.toHaveBeenCalled()
		f.actor.send({ type: 'SHUTDOWN' })
		await waitFor(f.actor, (s) => s.status === 'done', { timeout: 1000 })
		expect(releasedB).toHaveBeenCalledOnce()
	} finally {
		detached.resolve()
		persisted.resolve()
		f.actor.stop()
		a.port1.close()
		a.port2.close()
		b.port1.close()
		b.port2.close()
	}
})
