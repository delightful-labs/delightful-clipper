import { expect, it } from 'vitest'
import { prepareSave, verifyParts } from './codec.js'

it.each([NaN, Infinity, -1, 1.5])('rejects invalid manifest lengths %s', async (value) => {
	const draft = await prepareSave(crypto.randomUUID(), {
		operationId: crypto.randomUUID(),
		title: 'Title',
		text: 'text',
		bytes: new Uint8Array([1, 2, 3]),
		mediaType: 'application/octet-stream'
	})
	for (const field of ['byteLength', 'originalByteLength', 'partCount'] as const) {
		await expect(
			verifyParts({ manifest: { ...draft.manifest, [field]: value }, parts: draft.parts })
		).rejects.toThrow()
	}
})
