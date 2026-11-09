import type { EventPayload } from '../machines/events.js'
import { types, createCallbackLogic, setup } from 'xstate'

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
type ViewportReport = Extract<ReaderExperienceEvent, { type: 'MEASURE' | 'VIEWPORT_FAILED' }>
type Input = ViewportElements & {
	attachmentId: string
	position: ReadingPosition | undefined
	report?: (event: ViewportReport) => void
}
type FrameEvent = { type: 'LAYOUT_FRAME' | 'PAINT_FRAME' | 'MEASURE_FRAME' }
type Event =
	| FrameEvent
	| {
			type:
				| 'SCROLL'
				| 'REFLOW'
				| 'USER_INTERACT'
				| 'DETACH'
				| 'SCROLLED'
				| 'RESIZE'
				| 'OBSERVING'
				| 'LISTENING'
	  }
	| { type: 'SIZES_MEASURED'; sizes: Size[] }
	| { type: 'CONTROLLER_CREATED'; controller: AbortController }
	| { type: 'OBSERVER_CREATED'; observer: ResizeObserver }
	| { type: 'ANCHOR_LOCATED'; anchor: DOMRect | undefined }
	| { type: 'INPUT'; event: globalThis.Event }
	| { type: 'MEASURED' | 'FINAL_MEASURED'; position: ReadingPosition | undefined }
type Size = { width: number; height: number }
type Context = Input & {
	index: ReadingTextIndex
	targets: HTMLElement[]
	sizes: Size[]
	controller: AbortController | undefined
	observer: ResizeObserver | undefined
	nextSizes: Size[]
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
const frame = createCallbackLogic<FrameEvent, FrameEvent>(({ input, sendBack }) => {
	const handle = requestAnimationFrame(() => sendBack(input))
	return () => cancelAnimationFrame(handle)
})
// These leases each acquire one native resource. Their invocation scopes own release,
// including abrupt actor stop; setup order and partial failure are state transitions.
const controller = createCallbackLogic<Event, Context>(({ input, sendBack }) => {
	const controller = new input.root.ownerDocument.defaultView!.AbortController()
	sendBack({ type: 'CONTROLLER_CREATED', controller })
	return () => controller.abort()
})
const observer = createCallbackLogic<Event>(({ sendBack }) => {
	const observer = new ResizeObserver(() => sendBack({ type: 'RESIZE' }))
	sendBack({ type: 'OBSERVER_CREATED', observer })
	return () => observer.disconnect()
})
const registerObservation = createCallbackLogic<Event, Context>(({ input, sendBack }) => {
	for (const target of input.targets) required(input.observer).observe(target)
	sendBack({ type: 'OBSERVING' })
})
const registerListeners = createCallbackLogic<
	Event,
	{ context: Context; report: (event: Event) => void }
>(({ input: { context: input, report }, sendBack }) => {
	const options = { passive: true, signal: required(input.controller).signal }
	input.scroller.addEventListener('scroll', () => report({ type: 'SCROLL' }), options)
	for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
		input.scroller.addEventListener(name, (event) => report({ type: 'INPUT', event }), options)
	sendBack({ type: 'LISTENING' })
})
const measureSizes = createCallbackLogic<Event, Context>(({ input, sendBack }) => {
	sendBack({ type: 'SIZES_MEASURED', sizes: sizes(input.targets) })
})
const finalMeasurement = createCallbackLogic<Event, Context>(({ input, sendBack }) => {
	sendBack({ type: 'FINAL_MEASURED', position: measurePosition(input) })
})

const measurement = createCallbackLogic<Event, Context>(({ input, sendBack }) => {
	sendBack({ type: 'MEASURED', position: measurePosition(input) })
})
const locateAnchor = createCallbackLogic<Event, Context>(({ input, sendBack }) => {
	sendBack({ type: 'ANCHOR_LOCATED', anchor: matchingAnchor(input) })
})
const scrollToAnchor = createCallbackLogic<Event, Context>(({ input, sendBack }) => {
	input.scroller.scrollTop += required(input.anchor).top - viewportTop(input.scroller)
	sendBack({ type: 'SCROLLED' })
})
const scrollToStart = createCallbackLogic<Event, Context>(({ input, sendBack }) => {
	input.scroller.scrollTop = 0
	sendBack({ type: 'SCROLLED' })
})

export const viewportMachine = setup({
	schemas: {
		context: types<Context>(),
		events: {
			LAYOUT_FRAME: types<EventPayload<Event, 'LAYOUT_FRAME'>>(),
			PAINT_FRAME: types<EventPayload<Event, 'PAINT_FRAME'>>(),
			MEASURE_FRAME: types<EventPayload<Event, 'MEASURE_FRAME'>>(),
			REFLOW: types<EventPayload<Event, 'REFLOW'>>(),
			DETACH: types<EventPayload<Event, 'DETACH'>>(),
			SCROLL: types<EventPayload<Event, 'SCROLL'>>(),
			USER_INTERACT: types<EventPayload<Event, 'USER_INTERACT'>>(),
			SCROLLED: types<EventPayload<Event, 'SCROLLED'>>(),
			RESIZE: types<EventPayload<Event, 'RESIZE'>>(),
			OBSERVING: types<EventPayload<Event, 'OBSERVING'>>(),
			LISTENING: types<EventPayload<Event, 'LISTENING'>>(),
			SIZES_MEASURED: types<EventPayload<Event, 'SIZES_MEASURED'>>(),
			CONTROLLER_CREATED: types<EventPayload<Event, 'CONTROLLER_CREATED'>>(),
			OBSERVER_CREATED: types<EventPayload<Event, 'OBSERVER_CREATED'>>(),
			ANCHOR_LOCATED: types<EventPayload<Event, 'ANCHOR_LOCATED'>>(),
			INPUT: types<EventPayload<Event, 'INPUT'>>(),
			MEASURED: types<EventPayload<Event, 'MEASURED'>>(),
			FINAL_MEASURED: types<EventPayload<Event, 'FINAL_MEASURED'>>()
		},
		input: types<Input>(),
		output: types<ViewportResult>(),
		tags: types<string>(),
		children: {
			frame: types<import('xstate').ActorRefFrom<typeof frame>>(),
			controller: types<import('xstate').ActorRefFrom<typeof controller>>(),
			observer: types<import('xstate').ActorRefFrom<typeof observer>>(),
			registerObservation: types<import('xstate').ActorRefFrom<typeof registerObservation>>(),
			registerListeners: types<import('xstate').ActorRefFrom<typeof registerListeners>>(),
			measureSizes: types<import('xstate').ActorRefFrom<typeof measureSizes>>(),
			finalMeasurement: types<import('xstate').ActorRefFrom<typeof finalMeasurement>>(),
			measurement: types<import('xstate').ActorRefFrom<typeof measurement>>(),
			locateAnchor: types<import('xstate').ActorRefFrom<typeof locateAnchor>>(),
			scrollToAnchor: types<import('xstate').ActorRefFrom<typeof scrollToAnchor>>(),
			scrollToStart: types<import('xstate').ActorRefFrom<typeof scrollToStart>>()
		}
	},
	actors: {
		frame,
		controller,
		observer,
		registerObservation,
		registerListeners,
		measureSizes,
		finalMeasurement,
		measurement,
		locateAnchor,
		scrollToAnchor,
		scrollToStart
	},
	actions: {
		report: (
			{ context, parent }: { context: Context; parent: import('xstate').AnyActorRef | undefined },
			report: ViewportReport
		) => {
			if (context.report) context.report(report)
			else parent?.send(report)
		}
	},
	guards: {
		readingInteraction: ({ context, event }: { context: Context; event: Event }) =>
			event.type === 'INPUT' && isReadingInteraction(event.event, context),
		changedSizes: ({ context }: { context: Context }, params: { sizes: Context['nextSizes'] }) =>
			changedSizes(context, params.sizes),
		visibleAnchor: (_: { context: Context }, params: { anchor: Context['anchor'] }) =>
			!!params.anchor?.height,
		newPosition: ({ context, event }: { context: Context; event: Event }) =>
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
			controller: undefined,
			observer: undefined,
			nextSizes: [],
			anchor: undefined,
			finalPosition: undefined
		}
	},
	initial: 'owningController',
	output: ({ context }) => ({ position: context.finalPosition }),
	on: { DETACH: { target: '.disposing' } },
	states: {
		owningController: {
			initial: 'creatingController',
			invoke: {
				id: 'controller',
				src: 'controller',
				input: ({ context }: { context: Context }) => context,
				onError: { target: '#reader-viewport.disposingFailure' }
			},
			states: {
				creatingController: {
					on: {
						CONTROLLER_CREATED: (args) => {
							return { target: 'owningObserver', context: { controller: args.event.controller } }
						}
					}
				},
				owningObserver: {
					initial: 'creatingObserver',
					invoke: {
						id: 'observer',
						src: 'observer',
						onError: { target: '#reader-viewport.disposingFailure' }
					},
					states: {
						creatingObserver: {
							on: {
								OBSERVER_CREATED: (args) => {
									return {
										target: 'registeringObservation',
										context: { observer: args.event.observer }
									}
								}
							}
						},
						registeringObservation: {
							invoke: {
								id: 'registerObservation',
								src: 'registerObservation',
								input: ({ context }: { context: Context }) => context,
								onError: { target: '#reader-viewport.disposingFailure' }
							},
							on: { OBSERVING: { target: 'registeringListeners' } }
						},
						registeringListeners: {
							invoke: {
								id: 'registerListeners',
								src: 'registerListeners',
								input: ({ context, self }) => ({ context, report: (event) => self.send(event) }),
								onError: { target: '#reader-viewport.disposingFailure' }
							},
							on: { LISTENING: { target: 'active' } }
						},
						active: {
							type: 'parallel',
							on: {
								INPUT: (args, enq) => {
									if (!args.guards.readingInteraction(args)) return
									enq.raise({ type: 'USER_INTERACT' })
									enq.raise({ type: 'SCROLL' })
								},
								DETACH: { target: '#reader-viewport.disposing' }
							},
							states: {
								flow: {
									initial: 'waitingForLayout',
									on: { REFLOW: { target: '.waitingForLayout' } },
									states: {
										waitingForLayout: {
											invoke: {
												src: 'frame',
												input: { type: 'LAYOUT_FRAME' },
												onError: { target: '#reader-viewport.disposingFailure' }
											},
											on: {
												LAYOUT_FRAME: { target: 'locatingAnchor' },
												USER_INTERACT: { target: 'reading' }
											}
										},
										locatingAnchor: {
											invoke: {
												id: 'locateAnchor',
												src: 'locateAnchor',
												input: ({ context }: { context: Context }) => context,
												onError: { target: '#reader-viewport.disposingFailure' }
											},
											on: {
												ANCHOR_LOCATED: (args) => {
													const { event } = args
													if (args.guards.visibleAnchor(args, { anchor: event.anchor })) {
														return {
															target: 'scrollingToAnchor',
															context: { anchor: event.anchor }
														}
													}
													return { target: 'scrollingToStart', context: { anchor: event.anchor } }
												}
											}
										},
										scrollingToAnchor: {
											invoke: {
												id: 'scrollToAnchor',
												src: 'scrollToAnchor',
												input: ({ context }: { context: Context }) => context,
												onError: { target: '#reader-viewport.disposingFailure' }
											},
											on: { SCROLLED: { target: 'waitingForPaint' } }
										},
										scrollingToStart: {
											invoke: {
												id: 'scrollToStart',
												src: 'scrollToStart',
												input: ({ context }: { context: Context }) => context,
												onError: { target: '#reader-viewport.disposingFailure' }
											},
											on: { SCROLLED: { target: 'waitingForPaint' } }
										},
										waitingForPaint: {
											invoke: {
												src: 'frame',
												input: { type: 'PAINT_FRAME' },
												onError: { target: '#reader-viewport.disposingFailure' }
											},
											on: {
												PAINT_FRAME: { target: 'passive' },
												USER_INTERACT: { target: 'reading' }
											}
										},
										passive: { on: { USER_INTERACT: { target: 'reading' } } },
										reading: {
											on: {
												MEASURED: (args, enq) => {
													if (!args.guards.newPosition(args)) return
													const { event } = args
													let context = args.context
													let patch = {}
													patch = { ...patch, position: event.position }
													context = { ...args.context, ...patch }
													enq(
														args.actions.report,
														{ ...args, context },
														{
															type: 'MEASURE',
															attachmentId: context.attachmentId,
															position: required(event.position)
														}
													)
													return { context: patch }
												},
												DETACH: { target: '#reader-viewport.departing' }
											}
										}
									}
								},
								sizeObservation: {
									initial: 'idle',
									states: {
										idle: { on: { RESIZE: { target: 'measuringSizes' } } },
										measuringSizes: {
											invoke: {
												id: 'measureSizes',
												src: 'measureSizes',
												input: ({ context }: { context: Context }) => context,
												onError: { target: '#reader-viewport.disposingFailure' }
											},
											on: {
												SIZES_MEASURED: (args, enq) => {
													const { event } = args
													if (args.guards.changedSizes(args, { sizes: event.sizes })) {
														enq.raise({ type: 'REFLOW' })
														return {
															target: 'idle',
															context: { sizes: event.sizes, nextSizes: event.sizes }
														}
													}
													return { target: 'idle', context: { nextSizes: event.sizes } }
												}
											}
										}
									}
								},

								measurement: {
									initial: 'idle',
									states: {
										idle: { on: { SCROLL: { target: 'framePending' } } },
										framePending: {
											invoke: {
												src: 'frame',
												input: { type: 'MEASURE_FRAME' },
												onError: { target: '#reader-viewport.disposingFailure' }
											},
											on: { MEASURE_FRAME: { target: 'measuring' }, SCROLL: {} }
										},
										measuring: {
											invoke: {
												id: 'measurement',
												src: 'measurement',
												input: ({ context }: { context: Context }) => context,
												onError: { target: '#reader-viewport.disposingFailure' }
											},
											on: { MEASURED: { target: 'idle' } }
										}
									}
								}
							}
						}
					}
				}
			}
		},
		disposing: { always: { target: 'closed' } },
		disposingFailure: { always: { target: 'failed' } },

		departing: {
			invoke: {
				id: 'finalMeasurement',
				src: 'finalMeasurement',
				input: ({ context }: { context: Context }) => context,
				onError: (args) => {
					return { target: 'closed', context: { finalPosition: args.context.position } }
				}
			},
			on: {
				FINAL_MEASURED: (args) => {
					return {
						target: 'closed',
						context: { finalPosition: args.event.position ?? args.context.position }
					}
				}
			}
		},
		closed: { type: 'final' },
		failed: {
			type: 'final',
			entry: (args, enq) => {
				enq(args.actions.report, args, {
					type: 'VIEWPORT_FAILED',
					attachmentId: args.context.attachmentId
				})
			}
		}
	}
})
