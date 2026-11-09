import type { EventPayload } from '../machines/events.js'
import { types, createCallbackLogic, setup } from 'xstate'

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
const transport = createCallbackLogic<Event, SurfaceViewportInput>(
	({ input, receive, sendBack }) => {
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
			type: 'VIEWPORT_OPEN' as const,
			attachmentId: input.attachmentId,
			position: input.position
		})
		return () => port.removeEventListener('message', report)
	}
)
const actors = { native: viewportMachine, transport }
export const surfaceViewportMachine = setup({
	schemas: {
		context: types<Context>(),
		events: {
			MEASURE: types<EventPayload<Event, 'MEASURE'>>(),
			VIEWPORT_FAILED: types<EventPayload<Event, 'VIEWPORT_FAILED'>>(),
			VIEWPORT_CLOSED: types<EventPayload<Event, 'VIEWPORT_CLOSED'>>(),
			REFLOW: types<EventPayload<Event, 'REFLOW'>>(),
			DETACH: types<EventPayload<Event, 'DETACH'>>()
		},
		input: types<SurfaceViewportInput>(),
		output: types<ViewportResult>(),
		tags: types<string>(),
		children: {
			native: types<import('xstate').ActorRefFrom<(typeof actors)['native']>>(),
			transport: types<import('xstate').ActorRefFrom<(typeof actors)['transport']>>()
		}
	},
	actors,
	guards: { native: ({ context }: { context: Context }) => 'native' in context.input }
}).createMachine({
	id: 'reader-surface-viewport',
	context: ({ input }) => ({ input, position: undefined }),
	output: ({ context }) => ({ position: context.position }),
	initial: 'admitting',
	states: {
		admitting: {
			type: 'choice',
			choice: (args) => {
				if (args.guards.native(args)) {
					return { target: 'native' }
				}
				return { target: 'remote' }
			}
		},
		native: {
			invoke: {
				id: 'native',
				src: 'native',
				input: ({ context }: { context: Context }) => {
					if (!('native' in context.input)) throw new Error('Reader elements unavailable')
					return {
						...context.input.native,
						attachmentId: context.input.attachmentId,
						position: context.input.position
					}
				},
				onDone: (args) => {
					return { target: 'closed', context: { position: args.event.output.position } }
				}
			},
			on: {
				MEASURE: (args, enq) => {
					const { event } = args
					enq.sendTo(args.parent, event)
				},
				VIEWPORT_FAILED: (args, enq) => {
					const { event } = args
					enq.sendTo(args.parent, event)
				},
				DETACH: (args, enq) => {
					enq.sendTo('native', { type: 'DETACH' as const })
				},
				REFLOW: (args, enq) => {
					enq.sendTo('native', { type: 'REFLOW' as const })
				}
			}
		},
		remote: {
			invoke: {
				id: 'transport',
				src: 'transport',
				input: ({ context }: { context: Context }) => context.input
			},
			on: {
				MEASURE: (args, enq) => {
					const { event } = args
					enq.sendTo(args.parent, event)
				},
				VIEWPORT_FAILED: (args, enq) => {
					const { event } = args
					enq.sendTo(args.parent, event)
				},
				DETACH: (args, enq) => {
					enq.sendTo('transport', { type: 'DETACH' as const })
				},
				REFLOW: (args, enq) => {
					enq.sendTo('transport', { type: 'REFLOW' as const })
				},
				VIEWPORT_CLOSED: (args) => {
					return { target: 'closed', context: { position: args.event.position } }
				}
			}
		},
		closed: { type: 'final' as const }
	}
})
