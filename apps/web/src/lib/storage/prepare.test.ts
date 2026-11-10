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

it('keeps the full metadata in snapshots and fingerprints it independently of body content', async () => {
	const input = {
		...request(),
		excerpt: 'Unshortened description café 🦊. '.repeat(200),
		author: 'Ada Example',
		siteName: 'Example Journal',
		publishedTime: '2026-10-02T12:30:00+02:00',
		lang: 'ar',
		dir: 'rtl',
		featuredImageUrl: 'https://example.com/cover.png'
	}
	const saved = await prepareSave(libraryId, input)
	for (const [key, value] of Object.entries(input))
		if (
			[
				'excerpt',
				'author',
				'siteName',
				'publishedTime',
				'lang',
				'dir',
				'featuredImageUrl'
			].includes(key)
		)
			expect(saved.snapshot).toHaveProperty(key, value)
	for (const field of ['excerpt', 'author', 'siteName', 'publishedTime', 'lang', 'dir']) {
		expect(
			(await prepareSave(libraryId, { ...input, [field]: 'changed' })).intent.payloadHash
		).not.toBe(saved.intent.payloadHash)
	}
})

it('queues the featured image even when absent from the body and deduplicates matching inline images', async () => {
	const featuredImageUrl = 'https://example.com/cover.png'
	for (const html of [
		'<p>No inline image</p>',
		`<img data-clipper-image="${encodeURIComponent(featuredImageUrl)}">`
	]) {
		const saved = await prepareSave(libraryId, {
			...request(),
			mediaType: 'text/html',
			bytes: new TextEncoder().encode(html),
			featuredImageUrl
		})
		expect(saved.images).toHaveLength(1)
		expect(saved.images?.[0]).toMatchObject({
			sourceUrl: featuredImageUrl,
			status: 'pending',
			assetId: null
		})
	}
})
