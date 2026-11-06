import { expect, it } from 'vitest'
import { extractRenderedSource } from './extract.js'
import { imageSources } from '../../web/src/lib/images/schema.js'
it('retains rendered image sources/alt text and replaces untrusted markers before native declaration', () => {
	const paragraph =
		'<p>' + 'Readable rendered article context with reliable source evidence. '.repeat(35) + '</p>'
	const result = extractRenderedSource({
		url: 'https://example.com/story',
		base: 'https://example.com/articles/',
		html: `<html><head><title>Image capture</title></head><body><article>${paragraph}<img src="photo.png" alt="A source diagram" data-clipper-image="https%3A%2F%2Finjected.example%2F" /><img src="javascript:alert(1)" data-clipper-image="https%3A%2F%2Finjected.example%2F" />${paragraph}</article></body></html>`
	})
	expect(imageSources(result.html)).toEqual(['https://example.com/articles/photo.png'])
	expect(result.html).toContain('alt="A source diagram"')
	expect(result.text).toContain('Readable rendered article')
})
