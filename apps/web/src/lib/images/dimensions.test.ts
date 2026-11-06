import { expect, it, vi, afterEach } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { imageDimensions } from './dimensions.js'
import { imageProcessingMachine, canDecodeImage } from './process-machine.js'
import { imageSources, prepareImages, processedImageSchema } from './schema.js'
function png(width: number, height: number) {
	const bytes = new Uint8Array(24),
		view = new DataView(bytes.buffer)
	bytes.set([137, 80, 78, 71, 13, 10, 26, 10], 0)
	bytes.set([73, 72, 68, 82], 12)
	view.setUint32(16, width)
	view.setUint32(20, height)
	return bytes
}
afterEach(() => vi.unstubAllGlobals())
it('bounds decoded allocation from headers before invoking the decoder', async () => {
	const decode = vi.fn()
	vi.stubGlobal('createImageBitmap', decode)
	expect(imageDimensions(png(400, 200))).toEqual({ width: 400, height: 200 })
	expect(canDecodeImage({ bytes: png(10000, 10000), mediaType: 'image/png' })).toBe(false)
	expect(
		await toPromise(
			createActor(imageProcessingMachine, {
				input: { bytes: png(10000, 10000), mediaType: 'image/png' }
			}).start()
		)
	).toBeUndefined()
	expect(decode).not.toHaveBeenCalled()
	expect(imageDimensions(new Uint8Array([1, 2, 3]))).toBeUndefined()
})
it('keeps only bounded HTTP markers and deterministic per-snapshot image declarations', async () => {
	const html =
		'<img src="https://ignored.example/">' +
		'<img data-clipper-image="https%3A%2F%2Fexample.com%2Fimage.png%23fragment">'.repeat(2) +
		'<img data-clipper-image="javascript%3Aalert(1)"><img data-clipper-image="%bad">'
	expect(imageSources(html)).toEqual(['https://example.com/image.png'])
	const a = await prepareImages(crypto.randomUUID(), crypto.randomUUID(), html)
	expect(a).toHaveLength(1)
	expect(a[0]?.status).toBe('pending')
	expect((await prepareImages(a[0]!.libraryId, a[0]!.documentId, html))[0]?.id).toBe(a[0]?.id)
	expect(
		processedImageSchema.safeParse({
			bytes: new Uint8Array(2 * 1024 * 1024 + 1),
			mediaType: 'image/png',
			width: 1,
			height: 1
		}).success
	).toBe(false)
})
it('resizes without upscaling, uses lossless PNG, shrinks oversized outputs and releases its bitmap', async () => {
	const close = vi.fn(),
		drawImage = vi.fn(),
		sizes: [number, number][] = []
	vi.stubGlobal('createImageBitmap', async () => ({ width: 4096, height: 2048, close }))
	let encoding = 0
	vi.stubGlobal(
		'OffscreenCanvas',
		class {
			constructor(
				readonly width: number,
				readonly height: number
			) {
				sizes.push([width, height])
			}
			getContext() {
				return { drawImage }
			}
			async convertToBlob(options: { type: string }) {
				expect(options.type).toBe('image/png')
				return new Blob([new Uint8Array(++encoding === 1 ? 2 * 1024 * 1024 + 1 : 25)], {
					type: 'image/png'
				})
			}
		}
	)
	const result = await toPromise(
		createActor(imageProcessingMachine, {
			input: { bytes: png(4096, 2048), mediaType: 'image/png' }
		}).start()
	)
	expect(sizes).toEqual([
		[2048, 1024],
		[1536, 768]
	])
	expect(result).toMatchObject({ width: 1536, height: 768, mediaType: 'image/png' })
	expect(close).toHaveBeenCalledOnce()
})
it('releases a decoded bitmap after encoder failure', async () => {
	const close = vi.fn()
	vi.stubGlobal('createImageBitmap', async () => ({ width: 10, height: 5, close }))
	vi.stubGlobal(
		'OffscreenCanvas',
		class {
			getContext() {
				return { drawImage() {} }
			}
			async convertToBlob() {
				throw new Error('Encoder unavailable')
			}
		}
	)
	expect(
		await toPromise(
			createActor(imageProcessingMachine, {
				input: { bytes: png(10, 5), mediaType: 'image/png' }
			}).start()
		)
	).toBeUndefined()
	expect(close).toHaveBeenCalledOnce()
})

it('reads bounded JPEG, GIF and all supported WebP header variants, rejecting truncation', () => {
	const gif = new Uint8Array([71, 73, 70, 56, 57, 97, 2, 0, 3, 0])
	expect(imageDimensions(gif)).toEqual({ width: 2, height: 3 })
	const jpeg = new Uint8Array(21)
	jpeg.set([255, 216, 255, 192, 0, 17, 8, 0, 3, 0, 2])
	expect(imageDimensions(jpeg)).toEqual({ width: 2, height: 3 })
	for (const kind of ['VP8X', 'VP8 ', 'VP8L']) {
		const data = new Uint8Array(kind === 'VP8L' ? 25 : 30),
			view = new DataView(data.buffer)
		data.set(new TextEncoder().encode('RIFF'), 0)
		data.set(new TextEncoder().encode('WEBP' + kind), 8)
		if (kind === 'VP8X') {
			data[24] = 1
			data[27] = 2
		}
		if (kind === 'VP8 ') {
			data.set([157, 1, 42], 23)
			view.setUint16(26, 2, true)
			view.setUint16(28, 3, true)
		}
		if (kind === 'VP8L') {
			data[20] = 47
			view.setUint32(21, 1 + (2 << 14), true)
		}
		expect(imageDimensions(data)).toEqual({ width: 2, height: 3 })
		expect(imageDimensions(data.subarray(0, 20))).toBeUndefined()
	}
})
