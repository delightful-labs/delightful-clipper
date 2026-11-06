import { assign, fromCallback, raise, sendParent, setup } from 'xstate'
import type { ReadingPosition } from './schema.js'
import { positionSchema } from './schema.js'
import {
	readingTextIndex,
	rangeAt,
	positionAt,
	quoteMatches,
	sameReadingLocation
} from './anchors.js'
import type { ReadingTextIndex } from './anchors.js'
import type { ReaderExperienceEvent } from '../machines/reader/experience.js'

export type ViewportElements = { root: HTMLElement; scroller: HTMLElement }
type Input = ViewportElements & { attachmentId: string; position: ReadingPosition | undefined }
type FrameEvent = { type: 'LAYOUT_FRAME' | 'PAINT_FRAME' | 'MEASURE_FRAME' }
type Event =
	| FrameEvent
	| { type: 'SCROLL' | 'REFLOW' | 'USER_INTERACT' | 'DETACH' | 'SCROLLED' | 'DOM_FAILED' }
	| { type: 'RESIZE'; sizes: Size[] }
	| { type: 'ANCHOR_LOCATED'; anchor: DOMRect | undefined }
	| { type: 'INPUT'; event: globalThis.Event }
	| { type: 'MEASURED' | 'FINAL_MEASURED'; position: ReadingPosition | undefined }
type Size = { width: number; height: number }
type Context = Input & {
	index: ReadingTextIndex
	targets: HTMLElement[]
	sizes: Size[]
	anchor: DOMRect | undefined
	finalPosition: ReadingPosition | undefined
}
export type ViewportResult = { position: ReadingPosition | undefined }

function sizes(targets: readonly HTMLElement[]) {
	return targets.map((target) => {
		const { width, height } = target.getBoundingClientRect()
		return { width, height }
	})
}
function viewportTop(scroller: HTMLElement) {
	const top = scroller.getBoundingClientRect().top
	return Array.from(scroller.querySelectorAll<HTMLElement>('[data-reader-overlay]')).reduce(
		(edge, overlay) => {
			const rect = overlay.getBoundingClientRect()
			return rect.top <= top + 1 && rect.bottom > top ? Math.max(edge, rect.bottom) : edge
		},
		top
	)
}
function measurePosition({ root, scroller, index }: Context) {
	if (!index.points.length || !root.isConnected || !root.getBoundingClientRect().height)
		return undefined
	const top = viewportTop(scroller)
	let low = 0,
		high = index.points.length - 1
	while (low < high) {
		const middle = Math.floor((low + high) / 2)
		const rect = rangeAt(index, middle)?.getBoundingClientRect()
		if (!rect || rect.bottom <= top) low = middle + 1
		else high = middle
	}
	const end = root.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().bottom + 2
	return positionAt(index, low, end ? 1 : low / index.points.length)
}
function matchingAnchor({ index, position }: Context) {
	if (!position || !quoteMatches(index, position)) return undefined
	return rangeAt(index, position.offset)?.getBoundingClientRect()
}
function isReadingInteraction(event: globalThis.Event, { root, scroller }: Context) {
	const target = event.target
	if (!(target instanceof root.ownerDocument.defaultView!.Element)) return false
	if (target.closest('dialog, [popover], input, textarea, select, button')) return false
	if (event.type === 'wheel' || event.type === 'touchstart') return true
	return target === scroller || root.contains(target) || !!target.closest('[data-reader-contents]')
}
function changedSizes(context: Context, next: Size[]) {
	return (
		next.length !== context.sizes.length ||
		next.some(
			(size, index) =>
				context.sizes[index]?.width !== size.width || context.sizes[index]?.height !== size.height
		)
	)
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Viewport value unavailable')
	return value
}
const frame = fromCallback<FrameEvent, FrameEvent>(({ input, sendBack }) => {
	const handle = requestAnimationFrame(() => sendBack(input))
	return () => cancelAnimationFrame(handle)
})
const events = fromCallback<Event, Context>(({ input, sendBack }) => {
	const controller = new input.root.ownerDocument.defaultView!.AbortController()
	const observer = new ResizeObserver(() => {
		try {
			sendBack({ type: 'RESIZE', sizes: sizes(input.targets) })
		} catch {
			sendBack({ type: 'DOM_FAILED' })
		}
	})
	const dispose = () => {
		observer.disconnect()
		controller.abort()
	}
	try {
		for (const target of input.targets) observer.observe(target)
		const options = { passive: true, signal: controller.signal }
		input.scroller.addEventListener('scroll', () => sendBack({ type: 'SCROLL' }), options)
		for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
			input.scroller.addEventListener(name, (event) => sendBack({ type: 'INPUT', event }), options)
		return dispose
	} catch (error) {
		dispose()
		throw error
	}
})
const finalMeasurement = fromCallback<Event, Context>(({ input, sendBack }) => {
	sendBack({ type: 'FINAL_MEASURED', position: measurePosition(input) })
})

const measurement = fromCallback<Event, Context>(({ input, sendBack }) => {
	sendBack({ type: 'MEASURED', position: measurePosition(input) })
})
const locateAnchor = fromCallback<Event, Context>(({ input, sendBack }) => {
	sendBack({ type: 'ANCHOR_LOCATED', anchor: matchingAnchor(input) })
})
const scrollToAnchor = fromCallback<Event, Context>(({ input, sendBack }) => {
	input.scroller.scrollTop += required(input.anchor).top - viewportTop(input.scroller)
	sendBack({ type: 'SCROLLED' })
})
const scrollToStart = fromCallback<Event, Context>(({ input, sendBack }) => {
	input.scroller.scrollTop = 0
	sendBack({ type: 'SCROLLED' })
})

export const viewportMachine = setup<
	Context,
	Event,
	{
		frame: typeof frame
		events: typeof events
		finalMeasurement: typeof finalMeasurement
		measurement: typeof measurement
		locateAnchor: typeof locateAnchor
		scrollToAnchor: typeof scrollToAnchor
		scrollToStart: typeof scrollToStart
	},
	{},
	{},
	{
		readingInteraction: undefined
		changedSizes: undefined
		visibleAnchor: undefined
		newPosition: undefined
	},
	never,
	string,
	Input,
	ViewportResult
>({
	actors: {
		frame,
		events,
		finalMeasurement,
		measurement,
		locateAnchor,
		scrollToAnchor,
		scrollToStart
	},
	guards: {
		readingInteraction: ({ context, event }) =>
			event.type === 'INPUT' && isReadingInteraction(event.event, context),
		changedSizes: ({ context, event }) =>
			event.type === 'RESIZE' && changedSizes(context, event.sizes),
		visibleAnchor: ({ context }) => !!context.anchor?.height,
		newPosition: ({ context, event }) =>
			event.type === 'MEASURED' &&
			positionSchema.safeParse(event.position).success &&
			!sameReadingLocation(context.position, required(event.position))
	}
}).createMachine({
	id: 'reader-viewport',
	context: ({ input }) => {
		const targets = [
			input.root,
			input.scroller,
			...input.scroller.querySelectorAll<HTMLElement>('[data-reader-overlay]')
		]
		return {
			...input,
			index: readingTextIndex(input.root),
			targets,
			sizes: sizes(targets),
			anchor: undefined,
			finalPosition: undefined
		}
	},
	initial: 'active',
	output: ({ context }) => ({ position: context.finalPosition }),
	states: {
		active: {
			type: 'parallel',
			invoke: {
				src: 'events',
				input: ({ context }) => context,
				onError: '#reader-viewport.failed'
			},
			on: {
				INPUT: {
					guard: 'readingInteraction',
					actions: [raise({ type: 'USER_INTERACT' }), raise({ type: 'SCROLL' })]
				},
				RESIZE: {
					guard: 'changedSizes',
					actions: [assign({ sizes: ({ event }) => event.sizes }), raise({ type: 'REFLOW' })]
				},
				DOM_FAILED: '#reader-viewport.failed',
				DETACH: '#reader-viewport.closed'
			},
			states: {
				flow: {
					initial: 'waitingForLayout',
					on: { REFLOW: '.waitingForLayout' },
					states: {
						waitingForLayout: {
							invoke: {
								src: 'frame',
								input: { type: 'LAYOUT_FRAME' },
								onError: '#reader-viewport.failed'
							},
							on: { LAYOUT_FRAME: 'locatingAnchor', USER_INTERACT: 'reading' }
						},
						locatingAnchor: {
							invoke: {
								src: 'locateAnchor',
								input: ({ context }) => context,
								onError: '#reader-viewport.failed'
							},
							on: {
								ANCHOR_LOCATED: {
									target: 'choosingAnchor',
									actions: assign({ anchor: ({ event }) => event.anchor })
								}
							}
						},
						choosingAnchor: {
							always: [
								{ guard: 'visibleAnchor', target: 'scrollingToAnchor' },
								{ target: 'scrollingToStart' }
							]
						},
						scrollingToAnchor: {
							invoke: {
								src: 'scrollToAnchor',
								input: ({ context }) => context,
								onError: '#reader-viewport.failed'
							},
							on: { SCROLLED: 'waitingForPaint' }
						},
						scrollingToStart: {
							invoke: {
								src: 'scrollToStart',
								input: ({ context }) => context,
								onError: '#reader-viewport.failed'
							},
							on: { SCROLLED: 'waitingForPaint' }
						},
						waitingForPaint: {
							invoke: {
								src: 'frame',
								input: { type: 'PAINT_FRAME' },
								onError: '#reader-viewport.failed'
							},
							on: { PAINT_FRAME: 'passive', USER_INTERACT: 'reading' }
						},
						passive: { on: { USER_INTERACT: 'reading' } },
						reading: {
							on: {
								MEASURED: {
									guard: 'newPosition',
									actions: [
										assign({ position: ({ event }) => event.position }),
										sendParent(({ context, event }): ReaderExperienceEvent => ({
											type: 'MEASURE',
											attachmentId: context.attachmentId,
											position: required(event.position)
										}))
									]
								},
								DETACH: '#reader-viewport.departing'
							}
						}
					}
				},
				measurement: {
					initial: 'idle',
					states: {
						idle: { on: { SCROLL: 'framePending' } },
						framePending: {
							invoke: {
								src: 'frame',
								input: { type: 'MEASURE_FRAME' },
								onError: '#reader-viewport.failed'
							},
							on: { MEASURE_FRAME: 'measuring', SCROLL: {} }
						},
						measuring: {
							invoke: {
								src: 'measurement',
								input: ({ context }) => context,
								onError: '#reader-viewport.failed'
							},
							on: { MEASURED: 'idle' }
						}
					}
				}
			}
		},
		departing: {
			invoke: {
				src: 'finalMeasurement',
				input: ({ context }) => context,
				onError: {
					target: 'closed',
					actions: assign({ finalPosition: ({ context }) => context.position })
				}
			},
			on: {
				FINAL_MEASURED: {
					target: 'closed',
					actions: assign({
						finalPosition: ({ context, event }) => event.position ?? context.position
					})
				}
			}
		},
		closed: { type: 'final' },
		failed: {
			type: 'final',
			entry: sendParent(({ context }): ReaderExperienceEvent => ({
				type: 'VIEWPORT_FAILED',
				attachmentId: context.attachmentId
			}))
		}
	}
})
