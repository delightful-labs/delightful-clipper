import { assign, fromCallback, raise, sendParent, setup } from 'xstate'
import type {
	ReadingViewport,
	ViewportObservationEvent,
	ViewportSize
} from '../contracts/reader.js'
import type { ReadingPosition } from './schema.js'
import type { ReaderExperienceEvent } from '../machines/reader/experience.js'

type Input = { id: string; viewport: ReadingViewport }
type FrameEvent = { type: 'FRAME' }
type ObservationEvent =
	| ViewportObservationEvent
	| FrameEvent
	| { type: 'MEASURED'; position: ReadingPosition | undefined }

const animationFrame = fromCallback<FrameEvent>(({ sendBack }) => {
	const frame = requestAnimationFrame(() => sendBack({ type: 'FRAME' }))
	return () => cancelAnimationFrame(frame)
})
const observation = fromCallback<ObservationEvent, Input>(({ input, sendBack }) =>
	input.viewport.observe(sendBack)
)
const measurement = fromCallback<ObservationEvent, ReadingViewport>(({ input, sendBack }) => {
	sendBack({ type: 'MEASURED', position: input.measure() })
})
export function viewportSizesChanged(
	previous: readonly ViewportSize[],
	next: readonly ViewportSize[]
) {
	return (
		previous.length !== next.length ||
		next.some(
			(size, index) =>
				previous[index]?.width !== size.width || previous[index]?.height !== size.height
		)
	)
}
function measuredPosition(position: ReadingPosition | undefined) {
	if (position === undefined) throw new Error('Viewport measurement unavailable')
	return position
}
export const viewportObservation = setup<
	Input & { sizes: readonly ViewportSize[] },
	ObservationEvent,
	{
		observation: typeof observation
		animationFrame: typeof animationFrame
		measurement: typeof measurement
	},
	{},
	{ recordSizes: undefined },
	{ eligibleInteraction: undefined; sizeChanged: undefined; hasMeasurement: undefined },
	never,
	string,
	Input
>({
	actors: { observation, animationFrame, measurement },
	guards: {
		eligibleInteraction: ({ event }) => event.type === 'INTERACT' && event.eligible,
		sizeChanged: ({ context, event }) =>
			event.type === 'RESIZE' && viewportSizesChanged(context.sizes, event.sizes),
		hasMeasurement: ({ event }) => event.type === 'MEASURED' && event.position !== undefined
	},
	actions: {
		recordSizes: assign(({ event }) =>
			event.type === 'BASELINE' || event.type === 'RESIZE' ? { sizes: event.sizes } : {}
		)
	}
}).createMachine({
	id: 'viewport-observation',
	context: ({ input }) => ({ ...input, sizes: [] }),
	initial: 'active',
	states: {
		active: {
			invoke: { src: 'observation', input: ({ context }) => context, onError: 'failed' },
			initial: 'idle',
			on: {
				BASELINE: { actions: 'recordSizes' },
				RESIZE: {
					guard: 'sizeChanged',
					actions: [
						'recordSizes',
						sendParent(({ context }): ReaderExperienceEvent => ({
							type: 'RESIZE',
							attachmentId: context.id
						}))
					]
				},
				INTERACT: {
					guard: 'eligibleInteraction',
					actions: [
						sendParent(({ context }): ReaderExperienceEvent => ({
							type: 'INTERACT',
							attachmentId: context.id
						})),
						raise({ type: 'SCROLL' })
					]
				},
				VIEWPORT_FAILED: 'failed'
			},
			states: {
				idle: { on: { SCROLL: 'framePending' } },
				framePending: {
					invoke: { src: 'animationFrame', onError: '#viewport-observation.failed' },
					on: { FRAME: 'measuring', SCROLL: {} }
				},
				measuring: {
					invoke: {
						src: 'measurement',
						input: ({ context }) => context.viewport,
						onError: '#viewport-observation.failed'
					},
					on: {
						MEASURED: [
							{
								guard: 'hasMeasurement',
								target: 'idle',
								actions: sendParent(({ context, event }): ReaderExperienceEvent => ({
									type: 'MEASURE',
									attachmentId: context.id,
									position: measuredPosition(event.position)
								}))
							},
							{ target: 'idle' }
						]
					}
				}
			}
		},
		failed: {
			type: 'final',
			entry: sendParent(({ context }): ReaderExperienceEvent => ({
				type: 'VIEWPORT_FAILED',
				attachmentId: context.id
			}))
		}
	}
})

type RestorationInput = Input & { position: ReadingPosition | undefined }
type RestorationEvent = FrameEvent | { type: 'RESTORED_DOM' }
const restore = fromCallback<RestorationEvent, RestorationInput>(({ input, sendBack }) => {
	input.viewport.restore(input.position)
	sendBack({ type: 'RESTORED_DOM' })
})
export const viewportRestoration = setup<
	RestorationInput,
	RestorationEvent,
	{ animationFrame: typeof animationFrame; restore: typeof restore },
	{},
	{},
	{},
	never,
	string,
	RestorationInput
>({
	actors: { animationFrame, restore }
}).createMachine({
	id: 'viewport-restoration',
	context: ({ input }) => input,
	initial: 'waitingForLayout',
	states: {
		waitingForLayout: {
			invoke: { src: 'animationFrame', onError: 'failed' },
			on: { FRAME: 'restoring' }
		},
		restoring: {
			invoke: { src: 'restore', input: ({ context }) => context, onError: 'failed' },
			on: { RESTORED_DOM: 'waitingForPaint' }
		},
		waitingForPaint: {
			invoke: { src: 'animationFrame', onError: 'failed' },
			on: { FRAME: 'restored' }
		},
		restored: {
			type: 'final',
			entry: sendParent(({ context }): ReaderExperienceEvent => ({
				type: 'RESTORED',
				attachmentId: context.id
			}))
		},
		failed: {
			type: 'final',
			entry: sendParent(({ context }): ReaderExperienceEvent => ({
				type: 'VIEWPORT_FAILED',
				attachmentId: context.id
			}))
		}
	}
})

/** Departure can run after DOM removal; retain the last reliable observation if measurement fails. */
export function finalReadingPosition(
	viewport: ReadingViewport,
	previous: ReadingPosition | undefined
) {
	try {
		return viewport.measure() ?? previous
	} catch {
		return previous
	}
}
