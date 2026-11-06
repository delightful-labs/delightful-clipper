import { assign, fromCallback, fromPromise, setup } from 'xstate'
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
const decode = fromPromise<ImageBitmap, Input>(({ input }) =>
	createImageBitmap(new Blob([new Uint8Array(input.bytes)], { type: input.mediaType }))
)
const bitmap = fromCallback<{ type: 'UNUSED' }, ImageBitmap>(
	({ input }) =>
		() =>
			input.close()
)
const draw = fromPromise<OffscreenCanvas, Context>(async ({ input }) => {
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
})
const encode = fromPromise<Blob, Context>(({ input }) =>
	input.canvas!.convertToBlob({
		type: input.mediaType === 'image/png' ? 'image/png' : 'image/webp',
		quality: 0.82
	})
)
const bytes = fromPromise<ProcessedImage, Context>(async ({ input }) => ({
	bytes: new Uint8Array(await input.blob!.arrayBuffer()),
	mediaType: input.blob!.type === 'image/png' ? 'image/png' : 'image/webp',
	width: input.canvas!.width,
	height: input.canvas!.height
}))
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
export const imageProcessingMachine = setup<
	Context,
	{ type: 'UNUSED' },
	{
		decode: typeof decode
		bitmap: typeof bitmap
		draw: typeof draw
		encode: typeof encode
		bytes: typeof bytes
	},
	{},
	{},
	{ decodable: undefined; outputFits: undefined; canShrink: undefined },
	never,
	string,
	Input,
	ProcessedImage | undefined
>({
	actors: { decode, bitmap, draw, encode, bytes },
	guards: {
		decodable: ({ context }) => canDecodeImage(context),
		outputFits: ({ context }) =>
			!!context.blob?.size &&
			context.blob.size <= IMAGE_OUTPUT_LIMIT &&
			['image/png', 'image/webp'].includes(context.blob.type),
		canShrink: ({ context }) => context.attempts < 6 && context.edge > 64
	}
}).createMachine({
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
		checking: { always: [{ guard: 'decodable', target: 'decoding' }, { target: 'failed' }] },
		decoding: {
			invoke: {
				src: 'decode',
				input: ({ context }) => context,
				onDone: {
					target: 'processing',
					actions: assign({ bitmap: ({ event }) => event.output, bytes: () => new Uint8Array() })
				},
				onError: 'failed'
			}
		},
		processing: {
			initial: 'drawing',
			invoke: { src: 'bitmap', input: ({ context }) => context.bitmap! },
			states: {
				drawing: {
					invoke: {
						src: 'draw',
						input: ({ context }) => context,
						onDone: {
							target: 'encoding',
							actions: assign({ canvas: ({ event }) => event.output })
						},
						onError: '#image-processing.failed'
					}
				},
				encoding: {
					invoke: {
						src: 'encode',
						input: ({ context }) => context,
						onDone: {
							target: 'checkingSize',
							actions: assign({ blob: ({ event }) => event.output })
						},
						onError: '#image-processing.failed'
					}
				},
				checkingSize: {
					always: [
						{ guard: 'outputFits', target: 'readingBytes' },
						{ guard: 'canShrink', target: 'shrinking' },
						{ target: '#image-processing.failed' }
					]
				},
				shrinking: {
					entry: assign({
						edge: ({ context }) => Math.max(64, Math.floor(context.edge * 0.75)),
						attempts: ({ context }) => context.attempts + 1,
						canvas: undefined,
						blob: undefined
					}),
					always: 'drawing'
				},
				readingBytes: {
					invoke: {
						src: 'bytes',
						input: ({ context }) => context,
						onDone: {
							target: '#image-processing.done',
							actions: assign({ result: ({ event }) => event.output })
						},
						onError: '#image-processing.failed'
					}
				}
			}
		},
		done: {
			type: 'final',
			entry: assign({
				bitmap: undefined,
				canvas: undefined,
				blob: undefined,
				bytes: () => new Uint8Array()
			})
		},
		failed: {
			type: 'final',
			entry: assign({
				bitmap: undefined,
				canvas: undefined,
				blob: undefined,
				bytes: () => new Uint8Array()
			})
		}
	}
})
