import { assign, fromCallback, sendParent, sendTo, setup } from 'xstate'
import { z } from 'zod'
import { positionSchema } from './schema.js'
import { viewportMachine } from './viewport.js'
import type { SurfaceViewportInput } from './surface.js'
import type { ViewportResult } from './viewport.js'
const viewportReply = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('MEASURE'),
		attachmentId: z.string().uuid(),
		position: positionSchema
	}),
	z.object({ type: z.literal('VIEWPORT_FAILED'), attachmentId: z.string().uuid() }),
	z.object({ type: z.literal('VIEWPORT_CLOSED'), position: positionSchema.optional() })
])
type Event = z.infer<typeof viewportReply> | { type: 'DETACH' | 'REFLOW' }
type Context = { input: SurfaceViewportInput; position: ViewportResult['position'] }
const transport = fromCallback<Event, SurfaceViewportInput>(({ input, receive, sendBack }) => {
	if (!('port' in input)) throw new Error('Reader port unavailable')
	const port = input.port
	const report = ({ data }: MessageEvent<unknown>) => {
		const parsed = viewportReply.safeParse(data)
		if (parsed.success) sendBack(parsed.data)
	}
	port.addEventListener('message', report)
	port.start()
	receive((event) => port.postMessage(event))
	port.postMessage({
		type: 'VIEWPORT_OPEN',
		attachmentId: input.attachmentId,
		position: input.position
	})
	return () => port.removeEventListener('message', report)
})
const actors = { native: viewportMachine, transport }
export const surfaceViewportMachine = setup<
	Context,
	Event,
	typeof actors,
	{ transport: 'transport'; native: 'native' },
	{},
	{ native: undefined },
	never,
	string,
	SurfaceViewportInput,
	ViewportResult
>({
	actors,
	guards: { native: ({ context }) => 'native' in context.input }
}).createMachine({
	id: 'reader-surface-viewport',
	context: ({ input }) => ({ input, position: undefined }),
	output: ({ context }) => ({ position: context.position }),
	initial: 'admitting',
	states: {
		admitting: { always: [{ guard: 'native', target: 'native' }, { target: 'remote' }] },
		native: {
			invoke: {
				id: 'native',
				src: 'native',
				input: ({ context }) => {
					if (!('native' in context.input)) throw new Error('Reader elements unavailable')
					return {
						...context.input.native,
						attachmentId: context.input.attachmentId,
						position: context.input.position
					}
				},
				onDone: {
					target: 'closed',
					actions: assign({ position: ({ event }) => event.output.position })
				}
			},
			on: {
				MEASURE: { actions: sendParent(({ event }) => event) },
				VIEWPORT_FAILED: { actions: sendParent(({ event }) => event) },
				DETACH: { actions: sendTo('native', { type: 'DETACH' }) },
				REFLOW: { actions: sendTo('native', { type: 'REFLOW' }) }
			}
		},
		remote: {
			invoke: { id: 'transport', src: 'transport', input: ({ context }) => context.input },
			on: {
				MEASURE: { actions: sendParent(({ event }) => event) },
				VIEWPORT_FAILED: { actions: sendParent(({ event }) => event) },
				DETACH: { actions: sendTo('transport', { type: 'DETACH' }) },
				REFLOW: { actions: sendTo('transport', { type: 'REFLOW' }) },
				VIEWPORT_CLOSED: {
					target: 'closed',
					actions: assign({ position: ({ event }) => event.position })
				}
			}
		},
		closed: { type: 'final' }
	}
})
