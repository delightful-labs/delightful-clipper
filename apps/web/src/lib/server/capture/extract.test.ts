import { expect, it } from 'vitest'
import { extract } from './extract.js'
const paragraph =
	'<p>' +
	'A useful article sentence with enough context to keep the main content. '.repeat(40) +
	'</p>'
it('extracts inert sanitized content and preserves referenced footnotes without fetching images', () => {
	const html = `<html><head><title>Example article</title><link rel="canonical" href="https://canonical.example/article"></head><body><article><h1>Example article</h1>${paragraph}<p>A citation <a href="#fn1">1</a>.</p><img src="/photo.jpg" onerror="alert(1)"><script>globalThis.compromised=true</script><a href="javascript:alert(1)">Unsafe</a><iframe src="http://127.0.0.1"></iframe></article><aside><ol><li id="fn1" class="footnote">Footnote evidence</li></ol></aside></body></html>`
	const result = extract(
		new TextEncoder().encode(html),
		'text/html; charset=utf-8',
		'https://example.com/article'
	)
	expect(result.candidate.text).toContain('useful article')
	expect(result.candidate.text).toContain('Footnote evidence')
	expect(result.candidate.footnotes).toContain('fn1')
	expect(result.candidate.html).not.toMatch(/<script|<iframe|<img|onerror|javascript:/i)
	expect(result.canonicalCandidate).toBe('https://canonical.example/article')
	expect(
		result.candidate.assetCandidates.some(
			(asset) => asset.sourceUrl === 'https://example.com/photo.jpg'
		)
	).toBe(true)
})
it('renders plain text as literal escaped content', () => {
	const result = extract(
		new TextEncoder().encode('Literal <script>alert(1)</script> text'),
		'text/plain',
		'https://example.com/'
	)
	expect(result.candidate.text).toBe('Literal <script>alert(1)</script> text')
	expect(result.candidate.html).not.toContain('<script>')
})
it('rejects unsupported media and empty extraction', () => {
	expect(() => extract(new Uint8Array([1]), 'image/png', 'https://example.com/')).toThrow(
		'unsupportedMedia'
	)
	expect(() => extract(new Uint8Array(), 'text/html', 'https://example.com/')).toThrow(
		'parseFailed'
	)
})
