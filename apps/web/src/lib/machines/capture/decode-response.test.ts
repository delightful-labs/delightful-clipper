import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { decodeResponseMachine } from './decode-response.js'
it.each(['gzip', 'br', 'deflate'] as const)(
	'invokes only the selected %s decoder',
	async (encoding) => {
		const wire = new Uint8Array([1]),
			decoded = new Uint8Array([2]),
			decode = vi.fn(async () => decoded)
		const result = await toPromise(
			createActor(decodeResponseMachine, {
				input: {
					wire,
					encoding,
					headers: { status: 200, location: undefined, mediaType: 'text/html' },
					decode
				}
			}).start()
		)
		expect(decode).toHaveBeenCalledExactlyOnceWith(encoding, wire)
		expect(result.hop.body).toBe(decoded)
		expect(result.error).toBeUndefined()
	}
)
it.each([undefined, 'identity', 'unknown'])(
	'handles %s encoding without invoking a decoder',
	async (encoding) => {
		const wire = new Uint8Array([1]),
			decode = vi.fn(async () => wire)
		const result = await toPromise(
			createActor(decodeResponseMachine, {
				input: {
					wire,
					encoding,
					headers: { status: 200, location: undefined, mediaType: 'text/html' },
					decode
				}
			}).start()
		)
		expect(decode).not.toHaveBeenCalled()
		if (encoding === 'unknown') expect(result.error).toMatchObject({ code: 'unsupportedMedia' })
		else expect(result.hop.body).toBe(wire)
	}
)
