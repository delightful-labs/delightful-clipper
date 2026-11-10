import { types, createCallbackLogic, setup, matchesState } from 'xstate'
import { z } from 'zod'
import { positionSchema } from './schema.js'
import { viewportMachine } from './viewport.js'
import type { SurfaceViewportInput } from './surface.js'
import type { ViewportResult } from './viewport.js'
import {
	READER_REPLY_TIMEOUT_MS,
	monotonicNow,
	withinResourceDeadline
} from '../contracts/resource-waits.js'

const attachment = z.object({ attachmentId: z.string().uuid() })
export const viewportReplySchema = z.discriminatedUnion('type', [
	attachment.extend({ type: z.literal('MEASURE'), position: positionSchema }),
	attachment.extend({ type: z.literal('VIEWPORT_OPENED') }),
	attachment.extend({ type: z.literal('VIEWPORT_FAILED') }),
	attachment.extend({
		type: z.literal('VIEWPORT_SETTLED'),
		outcome: z.enum(['closed', 'failed']),
		position: positionSchema.optional()
	})
])
export type ViewportReply = z.infer<typeof viewportReplySchema>
type Reply = ViewportReply
type Result = ViewportResult & { outcome: 'closed' | 'failed' | 'overdue' }
type Context = {
	input: SurfaceViewportInput
	position: Result['position']
	outcome: Result['outcome']
}
const transport = createCallbackLogic<{ type: 'DETACH' | 'REFLOW' }, SurfaceViewportInput>(
	({ input, receive, sendBack }) => {
		if (!('port' in input)) throw new Error('Reader port unavailable')
		const port = input.port,
			now = input.now ?? monotonicNow
		let startedAt = now()
		const report = ({ data }: MessageEvent<unknown>) => {
			const parsed = viewportReplySchema.safeParse(data)
			if (parsed.success) sendBack({ ...parsed.data, elapsedMs: now() - startedAt })
		}
		const failed = () => sendBack({ type: 'TRANSPORT_FAILED' })
		const post = (message: object) => {
			try {
				port.postMessage(message)
			} catch {
				failed()
			}
		}
		port.addEventListener('message', report)
		port.addEventListener('messageerror', failed)
		port.start()
		receive((event) => {
			if (event.type === 'DETACH') startedAt = now()
			post(event)
		})
		post({ type: 'VIEWPORT_OPEN', attachmentId: input.attachmentId, position: input.position })
		return () => {
			port.removeEventListener('message', report)
			port.removeEventListener('messageerror', failed)
		}
	}
)
export const surfaceViewportMachine = setup({
	schemas: {
		context: types<Context>(),
		input: types<SurfaceViewportInput>(),
		output: types<Result>(),
		events: {
			MEASURE: types<Extract<Reply, { type: 'MEASURE' }> & { elapsedMs?: number }>(),
			VIEWPORT_OPENED: types<{ attachmentId: string; elapsedMs: number }>(),
			VIEWPORT_FAILED: types<{ attachmentId: string }>(),
			VIEWPORT_SETTLED: types<
				Extract<Reply, { type: 'VIEWPORT_SETTLED' }> & { elapsedMs: number }
			>(),
			TRANSPORT_FAILED: types(),
			REFLOW: types(),
			DETACH: types()
		},
		children: {
			native: types<import('xstate').ActorRefFrom<typeof viewportMachine>>(),
			transport: types<import('xstate').ActorRefFrom<typeof transport>>()
		}
	},
	actors: { native: viewportMachine, transport },
	delays: { reply: ({ context }) => context.input.replyTimeoutMs ?? READER_REPLY_TIMEOUT_MS },
	guards: {
		native: ({ context }) => 'native' in context.input,
		matching: ({ context }, event: { attachmentId: string }) =>
			event.attachmentId === context.input.attachmentId,
		withinDeadline: ({ context }, event: { elapsedMs: number }) =>
			withinResourceDeadline(
				event.elapsedMs,
				context.input.replyTimeoutMs ?? READER_REPLY_TIMEOUT_MS
			),
		open: ({ value }) => matchesState({ remote: 'active' }, value)
	},
	actions: {
		reportFailure: (
			{
				context,
				parent
			}: {
				context: Context
				parent:
					| {
							send: (event: {
								type: 'VIEWPORT_FAILED'
								attachmentId: string
								reason: 'failed' | 'overdue'
							}) => void
					  }
					| undefined
			},
			params: { reason: 'failed' | 'overdue' }
		) => {
			parent?.send({
				type: 'VIEWPORT_FAILED',
				attachmentId: context.input.attachmentId,
				reason: params.reason
			})
		}
	}
}).createMachine({
	id: 'reader-surface-viewport',
	context: ({ input }) => ({ input, position: undefined, outcome: 'closed' }),
	output: ({ context }) => ({ position: context.position, outcome: context.outcome }),
	initial: 'admitting',
	states: {
		admitting: {
			type: 'choice',
			choice: (args) => (args.guards.native(args) ? { target: 'native' } : { target: 'remote' })
		},
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
				onDone: ({ context, event }) => ({
					target: 'settled',
					context: { position: context.outcome === 'closed' ? event.output.position : undefined }
				}),
				onError: (args, enq) => {
					enq(args.actions.reportFailure, args, { reason: 'failed' })
					return { target: 'settled', context: { outcome: 'failed' } }
				}
			},
			on: {
				MEASURE: (args, enq) => {
					enq.sendTo(args.parent, args.event)
				},
				VIEWPORT_FAILED: (args, enq) => {
					enq(args.actions.reportFailure, args, { reason: 'failed' })
					return { context: { outcome: 'failed' } }
				},
				DETACH: (_args, enq) => {
					enq.sendTo('native', { type: 'DETACH' })
				},
				REFLOW: (_args, enq) => {
					enq.sendTo('native', { type: 'REFLOW' })
				}
			}
		},
		remote: {
			initial: 'opening',
			invoke: {
				id: 'transport',
				src: 'transport',
				input: ({ context }) => context.input,
				onError: { target: '.unavailable' }
			},
			on: {
				VIEWPORT_SETTLED: (args, enq) => {
					if (!args.guards.matching(args, args.event)) return
					if (args.context.outcome !== 'closed') return { target: 'settled' }
					if (args.event.outcome === 'failed') {
						enq(args.actions.reportFailure, args, { reason: 'failed' })
						return { target: 'settled', context: { outcome: 'failed' } }
					}
					if (!args.guards.withinDeadline(args, args.event) && !args.guards.open(args)) {
						enq(args.actions.reportFailure, args, { reason: 'overdue' })
						return { target: 'settled', context: { outcome: 'overdue' } }
					}
					return { target: 'settled', context: { position: args.event.position } }
				},
				VIEWPORT_FAILED: (args) =>
					args.guards.matching(args, args.event) ? { target: '.unavailable' } : undefined,
				TRANSPORT_FAILED: { target: '.unavailable' },
				DETACH: { target: '.closing' }
			},
			states: {
				opening: {
					timeout: 'reply',
					onTimeout: { target: 'overdue' },
					on: {
						VIEWPORT_OPENED: (args) => {
							if (!args.guards.matching(args, args.event)) return
							return args.guards.withinDeadline(args, args.event)
								? { target: 'active' }
								: { target: 'overdue' }
						}
					}
				},
				active: {
					on: {
						MEASURE: (args, enq) => {
							if (args.guards.matching(args, args.event)) enq.sendTo(args.parent, args.event)
						},
						REFLOW: (_args, enq) => {
							enq.sendTo('transport', { type: 'REFLOW' })
						}
					}
				},
				closing: {
					entry: (_args, enq) => {
						enq.sendTo('transport', { type: 'DETACH' })
					},
					timeout: 'reply',
					onTimeout: { target: 'overdue' },
					on: { DETACH: {} }
				},
				overdue: {
					entry: (args, enq) => {
						enq(args.actions.reportFailure, args, { reason: 'overdue' })
						enq.sendTo('transport', { type: 'DETACH' })
						return { context: { outcome: 'overdue' } }
					},
					on: { DETACH: {}, TRANSPORT_FAILED: {}, VIEWPORT_FAILED: {} }
				},
				unavailable: {
					entry: (args, enq) => {
						enq(args.actions.reportFailure, args, { reason: 'failed' })
						enq.sendTo('transport', { type: 'DETACH' })
						return { context: { outcome: 'failed' } }
					},
					on: { DETACH: {}, TRANSPORT_FAILED: {}, VIEWPORT_FAILED: {} }
				}
			}
		},
		settled: { type: 'final' }
	}
})
