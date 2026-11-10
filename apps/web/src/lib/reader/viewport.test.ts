import type { EventPayload } from '../machines/events.js'
import { types, createActor, setup } from 'xstate'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

import { viewportMachine, type ViewportElements, type ViewportResult } from './viewport.js'
import type { ReadingPosition } from './schema.js'
import type { ReaderExperienceEvent } from '../machines/reader/experience.js'
import {
	viewportDOM,
	installViewportDOM,
	closeViewportDOMs,
	TestResizeObserver
} from './viewport.test-support.js'

beforeEach(() => {
	installViewportDOM()
	vi.useFakeTimers()
	vi.stubGlobal(
		'requestAnimationFrame',
		vi.fn((callback: FrameRequestCallback) => setTimeout(() => callback(0), 1))
	)
	vi.stubGlobal(
		'cancelAnimationFrame',
		vi.fn((id: number) => clearTimeout(id))
	)
})
afterEach(() => {
	closeViewportDOMs()
	vi.useRealTimers()
	vi.unstubAllGlobals()
})

function owner(elements: ViewportElements, position: ReadingPosition | undefined = undefined) {
	const reports: ReaderExperienceEvent[] = [],
		outputs: ViewportResult[] = [],
		errors: unknown[] = []
	const actor = createActor(
		setup({
			schemas: {
				context: types<{}>(),
				events: {
					SYNC: types<
						EventPayload<ReaderExperienceEvent | { type: 'DETACH' | 'REFLOW' }, 'SYNC'>
					>(),
					MEASURE:
						types<EventPayload<ReaderExperienceEvent | { type: 'DETACH' | 'REFLOW' }, 'MEASURE'>>(),
					VIEWPORT_FAILED:
						types<
							EventPayload<ReaderExperienceEvent | { type: 'DETACH' | 'REFLOW' }, 'VIEWPORT_FAILED'>
						>(),
					CHANGE:
						types<EventPayload<ReaderExperienceEvent | { type: 'DETACH' | 'REFLOW' }, 'CHANGE'>>(),
					ROWS: types<
						EventPayload<ReaderExperienceEvent | { type: 'DETACH' | 'REFLOW' }, 'ROWS'>
					>(),
					ATTACH:
						types<EventPayload<ReaderExperienceEvent | { type: 'DETACH' | 'REFLOW' }, 'ATTACH'>>(),
					ATTACH_SURFACE:
						types<
							EventPayload<ReaderExperienceEvent | { type: 'DETACH' | 'REFLOW' }, 'ATTACH_SURFACE'>
						>(),
					SHUTDOWN:
						types<
							EventPayload<ReaderExperienceEvent | { type: 'DETACH' | 'REFLOW' }, 'SHUTDOWN'>
						>(),
					REFLOW:
						types<EventPayload<ReaderExperienceEvent | { type: 'DETACH' | 'REFLOW' }, 'REFLOW'>>(),
					DETACH:
						types<EventPayload<ReaderExperienceEvent | { type: 'DETACH' | 'REFLOW' }, 'DETACH'>>(),
					FOCUS:
						types<EventPayload<ReaderExperienceEvent | { type: 'DETACH' | 'REFLOW' }, 'FOCUS'>>(),
					SHOW_CONTROLS:
						types<
							EventPayload<ReaderExperienceEvent | { type: 'DETACH' | 'REFLOW' }, 'SHOW_CONTROLS'>
						>(),
					OBSERVATION_FAILED:
						types<
							EventPayload<
								ReaderExperienceEvent | { type: 'DETACH' | 'REFLOW' },
								'OBSERVATION_FAILED'
							>
						>(),
					REFRESH_SYNC:
						types<
							EventPayload<ReaderExperienceEvent | { type: 'DETACH' | 'REFLOW' }, 'REFRESH_SYNC'>
						>(),
					FULLSCREEN_CHANGED:
						types<
							EventPayload<
								ReaderExperienceEvent | { type: 'DETACH' | 'REFLOW' },
								'FULLSCREEN_CHANGED'
							>
						>(),
					FULLSCREEN_OBSERVED:
						types<
							EventPayload<
								ReaderExperienceEvent | { type: 'DETACH' | 'REFLOW' },
								'FULLSCREEN_OBSERVED'
							>
						>()
				},
				children: { viewport: types<import('xstate').ActorRefFrom<typeof viewportMachine>>() }
			},
			actors: { viewport: viewportMachine }
		}).createMachine({
			context: {},
			initial: 'active',
			states: {
				active: {
					invoke: {
						id: 'viewport',
						src: 'viewport',
						input: { ...elements, attachmentId: 'current', position },
						onDone: (args, enq) => {
							enq(({ event }) => {
								outputs.push(event.output)
							}, args)
							return { target: 'closed' }
						},
						onError: (args, enq) => {
							enq(({ event }) => {
								errors.push(event.error)
							}, args)
							return { target: 'failed' }
						}
					},
					on: {
						DETACH: (args, enq) => {
							enq(() => args.self.getSnapshot().children.viewport?.send({ type: 'DETACH' }))
						},
						REFLOW: (args, enq) => {
							enq(() => args.self.getSnapshot().children.viewport?.send({ type: 'REFLOW' }))
						}
					}
				},
				closed: {},
				failed: {}
			},
			on: {
				'*': (args, enq) => {
					enq(({ event }) => {
						if (event.type === 'MEASURE' || event.type === 'VIEWPORT_FAILED') reports.push(event)
					}, args)
				}
			}
		})
	).start()
	return { actor, reports, outputs, errors }
}
it('restores an anchor by writing the owned DOM and waits for a paint before recording reads', async () => {
	const dom = viewportDOM(),
		{ actor, reports, outputs } = owner(dom, dom.position(20))
	expect(dom.scroller.scrollTop).toBe(0)
	await vi.advanceTimersByTimeAsync(1)
	expect(dom.scroller.scrollTop).toBe(20)
	dom.scroll(30)
	await vi.advanceTimersByTimeAsync(2)
	expect(reports).toEqual([])
	actor.send({ type: 'DETACH' })
	expect(outputs).toEqual([{ position: undefined }])
	actor.stop()
})
it('opens at the beginning for an absent or mismatched anchor without overwriting it', async () => {
	const dom = viewportDOM()
	dom.scroller.scrollTop = 30
	const { actor, reports, outputs } = owner(dom, {
		...dom.position(20),
		quote: 'Not the saved text'
	})
	await vi.advanceTimersByTimeAsync(3)
	expect(dom.scroller.scrollTop).toBe(0)
	expect(reports).toEqual([])
	actor.send({ type: 'DETACH' })
	expect(outputs).toEqual([{ position: undefined }])
	actor.stop()
})
it('coalesces native scrolls into one frame and ignores controls inside the DOM', async () => {
	const dom = viewportDOM(),
		{ actor, reports } = owner(dom)
	await vi.advanceTimersByTimeAsync(3)
	const button = dom.document.createElement('button')
	dom.root.append(button)
	vi.mocked(requestAnimationFrame).mockClear()
	button.dispatchEvent(new dom.document.defaultView!.Event('wheel', { bubbles: true }))
	expect(requestAnimationFrame).not.toHaveBeenCalled()
	dom.interact()
	dom.scroll(10)
	dom.scroll(20)
	dom.scroll(30)
	expect(requestAnimationFrame).toHaveBeenCalledOnce()
	await vi.advanceTimersByTimeAsync(1)
	expect(reports).toEqual([
		expect.objectContaining({
			type: 'MEASURE',
			attachmentId: 'current',
			position: expect.objectContaining({ offset: 30, progress: 0.3 })
		})
	])
	actor.stop()
})
it('compares actual DOM sizes and reanchors the current position only when they change', async () => {
	const dom = viewportDOM(),
		{ actor, reports } = owner(dom)
	await vi.advanceTimersByTimeAsync(3)
	dom.interact()
	dom.scroll(40)
	await vi.advanceTimersByTimeAsync(1)
	vi.mocked(requestAnimationFrame).mockClear()
	dom.resize(800)
	expect(requestAnimationFrame).not.toHaveBeenCalled()
	dom.resize(700)
	await vi.advanceTimersByTimeAsync(3)
	expect(dom.scroller.scrollTop).toBe(40)
	expect(reports).toHaveLength(1)
	vi.mocked(requestAnimationFrame).mockClear()
	dom.resize(700)
	expect(requestAnimationFrame).not.toHaveBeenCalled()
	actor.stop()
})
it('cancels frames and disconnects DOM listeners when stopped', async () => {
	const dom = viewportDOM(),
		{ actor, reports } = owner(dom, dom.position(20))
	actor.stop()
	dom.interact()
	dom.scroll(60)
	await vi.advanceTimersByTimeAsync(5)
	expect(TestResizeObserver.instances[0]?.disconnect).toHaveBeenCalledOnce()
	expect(reports).toEqual([])
	expect(dom.scroller.scrollTop).toBe(60)
})
it('samples the DOM synchronously on departure and releases pending observation', async () => {
	const dom = viewportDOM(),
		{ actor, outputs } = owner(dom)
	await vi.advanceTimersByTimeAsync(3)
	dom.interact()
	dom.scroll(30)
	await vi.advanceTimersByTimeAsync(1)
	dom.scroll(60)
	actor.send({ type: 'DETACH' })
	expect(outputs[0]?.position).toMatchObject({ offset: 60, progress: 0.6 })
	expect(TestResizeObserver.instances[0]?.disconnect).toHaveBeenCalledOnce()
	actor.stop()
})
it('retains the last reliable position if final DOM measurement fails', async () => {
	const dom = viewportDOM(),
		{ actor, outputs, errors } = owner(dom)
	await vi.advanceTimersByTimeAsync(3)
	dom.interact()
	dom.scroll(30)
	await vi.advanceTimersByTimeAsync(1)
	dom.rootBounds.mockImplementation(() => {
		throw new Error('Detached DOM')
	})
	actor.send({ type: 'DETACH' })
	expect(outputs[0]?.position?.offset).toBe(30)
	expect(errors).toEqual([])
	actor.stop()
})
it('reports live DOM measurement errors to its owner and disposes resources', async () => {
	const dom = viewportDOM(),
		{ actor, reports } = owner(dom)
	await vi.advanceTimersByTimeAsync(3)
	dom.rootBounds.mockImplementation(() => {
		throw new Error('DOM unavailable')
	})
	dom.interact()
	dom.scroll(30)
	await vi.advanceTimersByTimeAsync(1)
	expect(reports).toEqual([{ type: 'VIEWPORT_FAILED', attachmentId: 'current' }])
	expect(TestResizeObserver.instances[0]?.disconnect).toHaveBeenCalledOnce()
	actor.stop()
})
it('handles frame acquisition and observer startup failures through the owner', () => {
	const dom = viewportDOM()
	vi.mocked(requestAnimationFrame).mockImplementationOnce(() => {
		throw new Error('Frame unavailable')
	})
	const first = owner(dom)
	expect(first.reports).toEqual([{ type: 'VIEWPORT_FAILED', attachmentId: 'current' }])
	first.actor.stop()
	vi.stubGlobal(
		'ResizeObserver',
		class extends TestResizeObserver {
			override observe = vi.fn<ResizeObserver['observe']>(() => {
				throw new Error('Observation unavailable')
			})
		}
	)
	const second = owner(dom)
	expect(second.reports).toEqual([{ type: 'VIEWPORT_FAILED', attachmentId: 'current' }])
	expect(TestResizeObserver.instances.at(-1)?.disconnect).toHaveBeenCalledOnce()
	second.actor.stop()
})

it('releases the controller if observer construction fails before registration', () => {
	const dom = viewportDOM(),
		abort = vi.spyOn(dom.document.defaultView!.AbortController.prototype, 'abort')
	vi.stubGlobal(
		'ResizeObserver',
		class {
			constructor() {
				throw new Error('Observer unavailable')
			}
		}
	)
	const { actor, reports } = owner(dom)
	expect(reports).toEqual([{ type: 'VIEWPORT_FAILED', attachmentId: 'current' }])
	expect(abort).toHaveBeenCalledOnce()
	expect(requestAnimationFrame).not.toHaveBeenCalled()
	actor.stop()
})
it('releases partial observations and registered listeners when listener registration fails', () => {
	const dom = viewportDOM(),
		abort = vi.spyOn(dom.document.defaultView!.AbortController.prototype, 'abort')
	const add = dom.scroller.addEventListener.bind(dom.scroller)
	vi.spyOn(dom.scroller, 'addEventListener').mockImplementation((name, listener, options) => {
		if (name === 'touchstart') throw new Error('Listener unavailable')
		add(name, listener, options)
	})
	const { actor, reports } = owner(dom)
	expect(reports).toEqual([{ type: 'VIEWPORT_FAILED', attachmentId: 'current' }])
	expect(abort).toHaveBeenCalledOnce()
	expect(TestResizeObserver.instances[0]?.disconnect).toHaveBeenCalledOnce()
	dom.rootBounds.mockClear()
	dom.interact()
	dom.scroll(50)
	expect(dom.rootBounds).not.toHaveBeenCalled()
	expect(requestAnimationFrame).not.toHaveBeenCalled()
	actor.stop()
})
it('handles resize measurement failure through state transitions and releases both resources', async () => {
	const dom = viewportDOM(),
		abort = vi.spyOn(dom.document.defaultView!.AbortController.prototype, 'abort')
	const { actor, reports } = owner(dom)
	await vi.advanceTimersByTimeAsync(3)
	dom.rootBounds.mockImplementation(() => {
		throw new Error('Geometry unavailable')
	})
	dom.resize(700)
	expect(reports).toEqual([{ type: 'VIEWPORT_FAILED', attachmentId: 'current' }])
	expect(abort).toHaveBeenCalledOnce()
	expect(TestResizeObserver.instances[0]?.disconnect).toHaveBeenCalledOnce()
	actor.stop()
})
