import type { EventPayload } from '../events.js'
import { types, setup, createAsyncLogic } from 'xstate'

import type { Hop } from '../../server/capture/transport.js'
import { CaptureError } from '../../server/capture/errors.js'
type Input = {
	wire: Uint8Array
	encoding: string | undefined
	headers: Omit<Hop, 'body'>
	decode: (format: 'gzip' | 'br' | 'deflate', wire: Uint8Array) => Promise<Uint8Array>
}
type Context = Input & { body: Uint8Array | undefined; error: unknown }
const decode = createAsyncLogic({
	run: ({ input }: { input: { format: 'gzip' | 'br' | 'deflate'; context: Context } }) =>
		input.context.decode(input.format, input.context.wire)
})
const model = setup({
	schemas: {
		context: types<Context>(),
		events: { UNUSED: types<EventPayload<{ type: 'UNUSED' }, 'UNUSED'>>() },
		input: types<Input>(),
		output: types<{ hop: Hop; error: unknown }>(),
		tags: types<string>(),
		children: { decode: types<import('xstate').ActorRefFrom<typeof decode>>() }
	},
	actors: { decode },
	actions: {
		useIdentityBody: ({ context }: { context: Context }) => ({ context: { body: context.wire } }),
		rejectEncoding: () => ({ context: { error: new CaptureError('unsupportedMedia', 415) } })
	}
})

export const decodeResponseMachine = model.createMachine({
	id: 'decode-capture-response',
	context: ({ input }) => ({ ...input, body: undefined, error: undefined }),
	initial: 'routingEncoding',
	output: ({ context }) => ({
		hop: { ...context.headers, body: context.body ?? new Uint8Array() },
		error: context.error
	}),
	states: {
		routingEncoding: {
			always: (args) => {
				const { context } = args
				if (!context.encoding || context.encoding === 'identity') {
					return { target: 'done', context: args.actions.useIdentityBody(args).context }
				}
				if (context.encoding === 'gzip') {
					return { target: 'gzip' }
				}
				if (context.encoding === 'br') {
					return { target: 'brotli' }
				}
				if (context.encoding === 'deflate') {
					return { target: 'deflate' }
				}
				return { target: 'done', context: args.actions.rejectEncoding().context }
			}
		},
		gzip: {
			invoke: {
				id: 'decode',
				src: 'decode',
				input: ({ context }: { context: Context }) => ({ context, format: 'gzip' }),
				onDone: (args) => {
					return { target: 'done', context: { body: args.event.output } }
				},
				onError: () => {
					return { target: 'done', context: { error: new CaptureError('sourceTooLarge', 413) } }
				}
			}
		},
		brotli: {
			invoke: {
				id: 'decode',
				src: 'decode',
				input: ({ context }: { context: Context }) => ({ context, format: 'br' }),
				onDone: (args) => {
					return { target: 'done', context: { body: args.event.output } }
				},
				onError: () => {
					return { target: 'done', context: { error: new CaptureError('sourceTooLarge', 413) } }
				}
			}
		},
		deflate: {
			invoke: {
				id: 'decode',
				src: 'decode',
				input: ({ context }: { context: Context }) => ({ context, format: 'deflate' }),
				onDone: (args) => {
					return { target: 'done', context: { body: args.event.output } }
				},
				onError: () => {
					return { target: 'done', context: { error: new CaptureError('sourceTooLarge', 413) } }
				}
			}
		},
		done: {
			type: 'final' as const,
			entry: () => {
				return { context: { wire: new Uint8Array() } }
			}
		}
	}
})
