import { JSDOM } from 'jsdom'
import { afterEach, expect, it, vi } from 'vitest'
import { serializePage } from './serialize.js'
import { extractRenderedSource } from './extract.js'
let dom: JSDOM | undefined
afterEach(() => {
	vi.unstubAllGlobals()
	dom?.window.close()
})
function page(body: string) {
	dom = new JSDOM(
		`<html><head><title>Browser capture</title><base href="https://example.com/base/"></head><body>${body}</body></html>`,
		{ url: 'https://example.com/article' }
	)
	vi.stubGlobal('document', dom.window.document)
	vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
	vi.stubGlobal('location', dom.window.location)
	vi.stubGlobal('XMLSerializer', dom.window.XMLSerializer)
}
const paragraphs =
	'<p>Useful browser capture content with Unicode café 🦊. This article explains retaining immutable local content, offline reading and meaningful source provenance without forwarding cookies or site credentials.</p>'.repeat(
		12
	)
it('serializes a clone without active content, input values or changes to the source DOM', () => {
	page(
		`<article onclick="PRIVATE_HANDLER">${paragraphs}<script>PRIVATE_SCRIPT</script><form><input value="PRIVATE_FORM_VALUE"></form><iframe srcdoc="PRIVATE_FRAME"></iframe></article>`
	)
	const result = serializePage()
	expect(result.html).not.toMatch(/PRIVATE_HANDLER|PRIVATE_SCRIPT|PRIVATE_FORM_VALUE|PRIVATE_FRAME/)
	expect(document.querySelector('form')).not.toBeNull()
	expect(document.querySelector('script')).not.toBeNull()
	expect(result.base).toBe('https://example.com/base/')
})
it('extracts the serialized DOM with absolute links, shared block text and referenced footnotes', () => {
	page(
		`<article><h1>Browser capture</h1>${paragraphs}<p>Footnote <a href="https://example.com/article#fn1">[1]</a>.</p><a href="related">Related</a></article><footer><aside id="fn1" class="footnote">Retained footnote evidence.</aside></footer>`
	)
	const content = extractRenderedSource(serializePage())
	expect(content.text).toContain('café 🦊')
	expect(content.text).toContain('\n\n')
	expect(content.html).toContain('https://example.com/base/related')
	expect(content.html).toContain('Retained footnote evidence.')
	expect(JSON.parse(content.provenance)).toMatchObject({
		type: 'browser-rendered',
		redirects: 'unobserved',
		normalizationVersion: '1'
	})
})
it('rejects malformed parser input without printing source fragments', () => {
	const log = vi.spyOn(console, 'log').mockImplementation(() => {})
	expect(() =>
		extractRenderedSource({
			url: 'https://example.com/',
			base: 'https://example.com/',
			html: '<html><body><div PRIVATE_SOURCE='
		})
	).toThrow()
	expect(log).not.toHaveBeenCalled()
	log.mockRestore()
})
it('rejects oversized source before extracting it', () => {
	page(`<article><p>${'x'.repeat(2 * 1024 * 1024)}</p></article>`)
	expect(() => serializePage()).toThrow('sourceTooLarge')
})

it('keeps image/structured markup inert without requiring a browser DOM in the extraction worker', () => {
	page(
		`<article>${paragraphs}<figure><img src="picture.png" alt="Picture" /><figcaption>Image caption</figcaption></figure><details open=""><summary>Details</summary><p>Structured detail.</p></details></article>`
	)
	const content = extractRenderedSource(serializePage())
	expect(content.text).toContain('Image caption')
	expect(content.text).toContain('Structured detail.')
	expect(content.finalUrl).toBe('https://example.com/article')
})
