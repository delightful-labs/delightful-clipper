import { assign, fromPromise, setup } from 'xstate'
import type { Hop } from '../../server/capture/transport.js'
import { CaptureError } from '../../server/capture/errors.js'
type Input = {
	wire: Uint8Array
	encoding: string | undefined
	headers: Omit<Hop, 'body'>
	decode: (format: 'gzip' | 'br' | 'deflate', wire: Uint8Array) => Promise<Uint8Array>
}
type Context = Input & { body: Uint8Array | undefined; error: unknown }
const decode = fromPromise(
	({ input }: { input: { format: 'gzip' | 'br' | 'deflate'; context: Context } }) =>
		input.context.decode(input.format, input.context.wire)
)
const model = setup<
	Context,
	{ type: 'UNUSED' },
	{ decode: typeof decode },
	{},
	{},
	{},
	never,
	string,
	Input,
	{ hop: Hop; error: unknown }
>({ actors: { decode } }).extend({
	actions: {
		useIdentityBody: assign({ body: ({ context }) => context.wire }),
		rejectEncoding: assign({ error: () => new CaptureError('unsupportedMedia', 415) })
	}
})
const compressed = (format: 'gzip' | 'br' | 'deflate') =>
	model.createStateConfig({
		invoke: {
			src: 'decode',
			input: ({ context }) => ({ context, format }),
			onDone: { target: 'done', actions: assign({ body: ({ event }) => event.output }) },
			onError: {
				target: 'done',
				actions: assign({ error: () => new CaptureError('sourceTooLarge', 413) })
			}
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
			always: [
				{
					guard: ({ context }) => !context.encoding || context.encoding === 'identity',
					target: 'done',
					actions: 'useIdentityBody'
				},
				{ guard: ({ context }) => context.encoding === 'gzip', target: 'gzip' },
				{ guard: ({ context }) => context.encoding === 'br', target: 'brotli' },
				{ guard: ({ context }) => context.encoding === 'deflate', target: 'deflate' },
				{ target: 'done', actions: 'rejectEncoding' }
			]
		},
		gzip: compressed('gzip'),
		brotli: compressed('br'),
		deflate: compressed('deflate'),
		done: { type: 'final', entry: assign({ wire: () => new Uint8Array() }) }
	}
})
