import { expect, it } from 'vitest'
import { extract } from './extract.js'

it('preserves code language metadata through Readability and removes source CSS classes', async () => {
	const result = await extract(
		new TextEncoder().encode(
			`<article><h1>Code article</h1>${paragraph}<pre class="example language-JS"><code class="token">const answer = 42;</code></pre>${paragraph}</article>`
		),
		'text/html',
		'https://example.com/code'
	)
	expect(result.candidate.html).toContain('class="language-js"')
	expect(result.candidate.html).not.toMatch(/class="(?:example|token)/)
	expect(result.candidate.text).toContain('const answer = 42;')
})
const paragraph =
	'<p>' +
	'A useful article sentence with enough context to keep the main content. '.repeat(40) +
	'</p>'
it('extracts inert sanitized content and preserves referenced footnotes without fetching images', async () => {
	const html = `<html><head><title>Example article</title><link rel="canonical" href="https://canonical.example/article"></head><body><article><h1>Example article</h1>${paragraph}<p>A citation <a href="#fn1">1</a>.</p><img src="/photo.jpg" onerror="alert(1)"><script>globalThis.compromised=true</script><a href="javascript:alert(1)">Unsafe</a><iframe src="http://127.0.0.1"></iframe></article><aside><ol><li id="fn1" class="footnote">Footnote evidence</li></ol></aside></body></html>`
	const result = await extract(
		new TextEncoder().encode(html),
		'text/html; charset=utf-8',
		'https://example.com/article'
	)
	expect(result.candidate.text).toContain('useful article')
	expect(result.candidate.text).toContain('Footnote evidence')
	expect(result.candidate.footnotes).toContain('fn1')
	expect(result.candidate.html).not.toMatch(/<script|<iframe|\bsrc=|\bsrcset=|onerror|javascript:/i)
	expect(result.candidate.html).toContain(
		'data-clipper-image="https%3A%2F%2Fexample.com%2Fphoto.jpg"'
	)
	expect(result.canonicalCandidate).toBe('https://canonical.example/article')
	expect(
		result.candidate.assetCandidates.some(
			(asset) => asset.sourceUrl === 'https://example.com/photo.jpg'
		)
	).toBe(true)
})
it('renders plain text as literal escaped content', async () => {
	const result = await extract(
		new TextEncoder().encode('Literal <script>alert(1)</script> text'),
		'text/plain',
		'https://example.com/'
	)
	expect(result.candidate.text).toBe('Literal <script>alert(1)</script> text')
	expect(result.candidate.html).not.toContain('<script>')
})
it('rejects unsupported media and empty extraction', async () => {
	await expect(extract(new Uint8Array([1]), 'image/png', 'https://example.com/')).rejects.toThrow(
		'unsupportedMedia'
	)
	await expect(extract(new Uint8Array(), 'text/html', 'https://example.com/')).rejects.toThrow(
		'parseFailed'
	)
})

it('preserves native disclosures and static SVG through real extraction', async () => {
	const result = await extract(
		new TextEncoder().encode(`<article><h1>Diagram article</h1>${paragraph}
 <details open><summary>More evidence</summary>${paragraph}</details>
 <svg viewBox="0 0 100 100"><title>Chart</title><path d="M0 0 L10 10" stroke="red"/><image href="https://spy.example/x"/><circle fill="url(https://spy.example/x)" r="2"/></svg>
 ${paragraph}</article>`),
		'text/html',
		'https://example.com/article'
	)
	expect(result.candidate.html).toContain('<details open="">')
	expect(result.candidate.html).toContain('<summary>More evidence</summary>')
	expect(result.candidate.html).toContain('<svg viewBox="0 0 100 100">')
	expect(result.candidate.html).toContain('stroke="red"')
	expect(result.candidate.html).not.toMatch(/<image|spy\.example|url\(/)
})
it('retains a full Readability excerpt independently from the saved body', async () => {
	const description = 'A short editorial description of the article.'
	const result = await extract(
		new TextEncoder().encode(
			`<html><head><title>Example</title><meta name="description" content="${description}"></head><body><article><h1>Example</h1><p>${'The detailed body contains additional useful evidence. '.repeat(30)}</p></article></body></html>`
		),
		'text/html',
		'https://example.com/article'
	)
	expect(result.candidate.excerpt).toBe(description)
	expect(result.candidate.text).toContain('The detailed body')
})

it('retains full excerpts and requested metadata with an independently selected featured image', async () => {
	const description = 'Full editorial description café 🦊. '.repeat(200).trim()
	const result = await extract(
		new TextEncoder().encode(
			`<html lang="ar"><head><title>Metadata article</title><meta name="description" content="${description}"><meta name="author" content="Ada Example"><meta property="og:site_name" content="Example Journal"><meta property="article:published_time" content="2026-10-02T12:30:00Z"><meta name="twitter:image" content="/twitter.png"><meta property="og:image" content="/cover.png"></head><body><article dir="rtl"><h1>Metadata article</h1>${paragraph}</article></body></html>`
		),
		'text/html; charset=utf-8',
		'https://example.com/article'
	)
	expect(result.candidate).toMatchObject({
		excerpt: description,
		author: 'Ada Example',
		siteName: 'Example Journal',
		publishedTime: '2026-10-02T12:30:00Z',
		lang: 'ar',
		dir: 'rtl',
		featuredImageUrl: 'https://example.com/cover.png'
	})
	expect(result.candidate.html).not.toContain('/cover.png')
})
