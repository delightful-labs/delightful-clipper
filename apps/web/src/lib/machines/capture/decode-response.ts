import { types, setup, createAsyncLogic } from 'xstate'

import type { Hop } from '../../server/capture/transport.js'
import { CaptureError } from '../../server/capture/errors.js'
type Input = {
	wire: Uint8Array
	encoding: string | undefined
	headers: Omit<Hop, 'body'>
	decode: (format: 'gzip' | 'br' | 'deflate', wire: Uint8Array) => Promise<Uint8Array>
}
type Format = 'gzip' | 'br' | 'deflate'
type Context = Input & { body: Uint8Array | undefined; error: unknown }
const decode = createAsyncLogic({
	run: ({ input }: { input: { format: Format; context: Context } }) =>
		input.context.decode(input.format, input.context.wire)
})
const model = setup({
	schemas: {
		context: types<Context>(),
		events: {},
		input: types<Input>(),
		output: types<{ hop: Hop; error: unknown }>(),
		tags: types<string>(),
		children: { decode: types<import('xstate').ActorRefFrom<typeof decode>>() }
	},
	states: { decoding: { schemas: { input: types<{ format: Format }>() } } },
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
				if (
					context.encoding === 'gzip' ||
					context.encoding === 'br' ||
					context.encoding === 'deflate'
				)
					return { target: 'decoding', input: { format: context.encoding } }
				return { target: 'done', context: args.actions.rejectEncoding().context }
			}
		},
		decoding: {
			invoke: {
				id: 'decode',
				src: 'decode',
				input: ({ context, input }) => ({ context, format: input.format }),
				onDone: ({ event }) => ({ target: 'done', context: { body: event.output } }),
				onError: () => ({
					target: 'done',
					context: { error: new CaptureError('sourceTooLarge', 413) }
				})
			}
		},
		done: {
			type: 'final',
			entry: () => {
				return { context: { wire: new Uint8Array() } }
			}
		}
	}
})
