import { expect, it } from 'vitest'
import { BYTE_LIMIT, TEXT_LIMIT, prepareSave } from './prepare.js'
const libraryId = crypto.randomUUID()
const request = () => ({
	operationId: crypto.randomUUID(),
	title: 'Title',
	text: 'café 🦊',
	bytes: new Uint8Array([1, 2, 3]),
	mediaType: 'application/octet-stream'
})
it('keeps native bytes intact and gives identical intent the same reconciliation fingerprint', async () => {
	const input = request()
	const first = await prepareSave(libraryId, input)
	const second = await prepareSave(libraryId, input)
	expect(first.asset.payload).toEqual(input.bytes)
	expect(first.intent.payloadHash).toBe(second.intent.payloadHash)
	input.bytes[0] = 9
	expect(first.asset.payload[0]).toBe(1)
	expect((await prepareSave(libraryId, input)).intent.payloadHash).not.toBe(
		first.intent.payloadHash
	)
	expect((await prepareSave(libraryId, { ...input, text: 'changed' })).intent.payloadHash).not.toBe(
		first.intent.payloadHash
	)
})
it('rejects oversized text and bytes before any persistence', async () => {
	await expect(
		prepareSave(libraryId, { ...request(), bytes: new Uint8Array(BYTE_LIMIT + 1) })
	).rejects.toThrow()
	await expect(
		prepareSave(libraryId, { ...request(), text: 'é'.repeat(TEXT_LIMIT) })
	).rejects.toThrow()
})
