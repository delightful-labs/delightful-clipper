import { types, createCallbackLogic, setup, createAsyncLogic } from 'xstate'

import { imageDimensions } from './dimensions.js'
import { IMAGE_EDGE, IMAGE_INPUT_LIMIT, IMAGE_OUTPUT_LIMIT, IMAGE_PIXELS } from './schema.js'
import type { ProcessedImage } from './schema.js'
type Input = { bytes: Uint8Array; mediaType: string }
type Context = Input & {
	bitmap: ImageBitmap | undefined
	canvas: OffscreenCanvas | undefined
	blob: Blob | undefined
	edge: number
	attempts: number
	result: ProcessedImage | undefined
}
const decode = createAsyncLogic<ImageBitmap, Input>({
	run: ({ input }) =>
		createImageBitmap(new Blob([new Uint8Array(input.bytes)], { type: input.mediaType }))
})
const bitmap = createCallbackLogic<never, ImageBitmap>(
	({ input }) =>
		() =>
			input.close()
)
const draw = createAsyncLogic<OffscreenCanvas, Context>({
	run: async ({ input }) => {
		const image = input.bitmap!
		const scale = Math.min(1, input.edge / Math.max(image.width, image.height))
		const canvas = new OffscreenCanvas(
			Math.max(1, Math.round(image.width * scale)),
			Math.max(1, Math.round(image.height * scale))
		)
		const context = canvas.getContext('2d')
		if (!context) throw new Error('Image canvas unavailable')
		context.drawImage(image, 0, 0, canvas.width, canvas.height)
		return canvas
	}
})
const encode = createAsyncLogic<Blob, Context>({
	run: ({ input }) =>
		input.canvas!.convertToBlob({
			type: input.mediaType === 'image/png' ? 'image/png' : 'image/webp',
			quality: 0.82
		})
})
const bytes = createAsyncLogic<ProcessedImage, Context>({
	run: async ({ input }) => ({
		bytes: new Uint8Array(await input.blob!.arrayBuffer()),
		mediaType: input.blob!.type === 'image/png' ? 'image/png' : 'image/webp',
		width: input.canvas!.width,
		height: input.canvas!.height
	})
})
export function canDecodeImage(input: Input) {
	const size = imageDimensions(input.bytes)
	return (
		!!size &&
		size.width > 0 &&
		size.height > 0 &&
		size.width * size.height <= IMAGE_PIXELS &&
		input.bytes.byteLength <= IMAGE_INPUT_LIMIT
	)
}
const imageProcessingModel = setup({
	schemas: {
		context: types<Context>(),
		events: {},
		input: types<Input>(),
		output: types<ProcessedImage | undefined>(),
		tags: types<string>(),
		children: {
			decode: types<import('xstate').ActorRefFrom<typeof decode>>(),
			bitmap: types<import('xstate').ActorRefFrom<typeof bitmap>>(),
			draw: types<import('xstate').ActorRefFrom<typeof draw>>(),
			encode: types<import('xstate').ActorRefFrom<typeof encode>>(),
			bytes: types<import('xstate').ActorRefFrom<typeof bytes>>()
		}
	},
	actors: { decode, bitmap, draw, encode, bytes },
	guards: {
		decodable: ({ context }: { context: Context }) => canDecodeImage(context),
		outputFits: (_: { context: Context }, { blob }: { blob: Blob }) =>
			!!blob.size &&
			blob.size <= IMAGE_OUTPUT_LIMIT &&
			['image/png', 'image/webp'].includes(blob.type),
		canShrink: ({ context }: { context: Context }) => context.attempts < 6 && context.edge > 64
	},
	actions: {
		shrink: ({ context }: { context: Context }) => ({
			context: {
				edge: Math.max(64, Math.floor(context.edge * 0.75)),
				attempts: context.attempts + 1,
				canvas: undefined,
				blob: undefined
			}
		})
	}
})
export const imageProcessingMachine = imageProcessingModel.createMachine({
	id: 'image-processing',
	initial: 'checking',
	context: ({ input }) => ({
		...input,
		bitmap: undefined,
		canvas: undefined,
		blob: undefined,
		result: undefined,
		edge: IMAGE_EDGE,
		attempts: 0
	}),
	output: ({ context }) => context.result,
	states: {
		checking: {
			type: 'choice',
			choice: (args) => {
				if (args.guards.decodable(args)) {
					return { target: 'decoding' }
				}
				return { target: 'failed' }
			}
		},
		decoding: {
			invoke: {
				id: 'decode',
				src: 'decode',
				input: ({ context }: { context: Context }) => context,
				onDone: (args) => {
					return {
						target: 'processing',
						context: { bitmap: args.event.output, bytes: new Uint8Array() }
					}
				},
				onError: { target: 'failed' }
			}
		},
		processing: {
			initial: 'drawing',
			invoke: {
				id: 'bitmap',
				src: 'bitmap',
				input: ({ context }: { context: Context }) => context.bitmap!
			},
			states: {
				drawing: {
					invoke: {
						id: 'draw',
						src: 'draw',
						input: ({ context }: { context: Context }) => context,
						onDone: (args) => {
							return { target: 'encoding', context: { canvas: args.event.output } }
						},
						onError: { target: '#image-processing.failed' }
					}
				},
				encoding: {
					invoke: {
						id: 'encode',
						src: 'encode',
						input: ({ context }: { context: Context }) => context,
						onDone: (args) => {
							const { event } = args
							if (args.guards.outputFits(args, { blob: event.output })) {
								return { target: 'readingBytes', context: { blob: event.output } }
							}
							if (args.guards.canShrink(args)) {
								return { target: 'drawing', context: args.actions.shrink(args).context }
							}
							return { target: '#image-processing.failed' }
						},
						onError: { target: '#image-processing.failed' }
					}
				},
				readingBytes: {
					invoke: {
						id: 'bytes',
						src: 'bytes',
						input: ({ context }: { context: Context }) => context,
						onDone: (args) => {
							return { target: '#image-processing.done', context: { result: args.event.output } }
						},
						onError: { target: '#image-processing.failed' }
					}
				}
			}
		},
		done: {
			type: 'final',
			entry: () => {
				return {
					context: {
						bitmap: undefined,
						canvas: undefined,
						blob: undefined,
						bytes: new Uint8Array()
					}
				}
			}
		},
		failed: {
			type: 'final',
			entry: () => {
				return {
					context: {
						bitmap: undefined,
						canvas: undefined,
						blob: undefined,
						bytes: new Uint8Array()
					}
				}
			}
		}
	}
})
