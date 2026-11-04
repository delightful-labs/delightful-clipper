import { expect, it } from 'vitest'
import { trustedSender, sourceUrlSchema, captureFor, matchingSource } from './protocol.js'
const id = '77777777-7777-4777-8777-777777777777'
export const capture = {
	version: 1 as const,
	id,
	tabId: 7,
	documentId: 'document',
	url: 'https://example.com/article',
	phase: 'ready' as const
}
export const source = {
	url: capture.url,
	base: capture.url,
	html: '<html><body><article>Text</article></body></html>'
}
it('admits only its own trusted top-level extension page', () => {
	const page = 'chrome-extension://extension-id/index.html'
	expect(
		trustedSender({ id: 'extension-id', url: page + '#' + id, frameId: 0 }, 'extension-id', page)
	).toBe(true)
	for (const sender of [
		{ id: 'extension-id', url: 'https://example.com/index.html' },
		{ id: 'other', url: page },
		{ id: 'extension-id', url: page + '.evil' },
		{ id: 'extension-id', url: page, frameId: 1 }
	])
		expect(trustedSender(sender, 'extension-id', page)).toBe(false)
})
it('rejects credentials, active schemes and oversized source metadata', () => {
	for (const url of [
		'https://name:secret@example.com/',
		'javascript:alert(1)',
		'file:///tmp/private',
		'https://example.com/' + 'x'.repeat(8192)
	])
		expect(sourceUrlSchema.safeParse(url).success).toBe(false)
})
it('binds stored captures to the requested ID and observed document URL', () => {
	expect(captureFor(capture, id)).toBe(true)
	expect(captureFor(capture, crypto.randomUUID())).toBe(false)
	expect(matchingSource(source, capture)).toBe(true)
	expect(matchingSource({ ...source, url: 'https://example.com/changed' }, capture)).toBe(false)
	expect(matchingSource({ ...source, html: 'x'.repeat(2 * 1024 * 1024 + 1) }, capture)).toBe(false)
})
