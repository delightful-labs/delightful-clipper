import { afterEach, expect, it } from 'vitest'
import { JSDOM } from 'jsdom'
import { savedContent } from './content.js'
import type { AssetResult } from '../contracts/storage.js'
import { BYTE_LIMIT } from '../storage/prepare.js'
const windows: JSDOM[] = []
function document() {
	const dom = new JSDOM('', { url: 'https://clipper.example/' })
	windows.push(dom)
	return dom.window.document
}
function asset(html: string): AssetResult {
	return { kind: 'available', mediaType: 'text/html', bytes: new TextEncoder().encode(html) }
}
afterEach(() => {
	for (const dom of windows) dom.window.close()
	windows.length = 0
})
it('retains article structure, Unicode, literal markup and references without remote resources', () => {
	const fragment = savedContent(
		asset(
			'<h2>café 🦊</h2><p><em>Emphasis</em> &lt;script&gt;</p><ul><li>Item</li></ul><blockquote>Quote</blockquote><pre><code>x &lt; y</code></pre><table><tr><th>Key</th><td>Value</td></tr></table>'
		),
		document()
	)!
	expect(fragment.querySelector('h2')?.textContent).toBe('café 🦊')
	expect(fragment.querySelector('em')?.textContent).toBe('Emphasis')
	expect(fragment.querySelector('p')?.textContent).toContain('<script>')
	expect(fragment.querySelector('li')?.textContent).toBe('Item')
	expect(fragment.querySelector('code')?.textContent).toBe('x < y')
	expect(fragment.querySelector('td')?.textContent).toBe('Value')
})
it('removes executable markup, styles, embedded resources and source navigation behavior', () => {
	const fragment = savedContent(
		asset(
			`<p onclick="alert(1)" style="background:url(https://spy.example/)">Keep</p><script>alert(1)</script><style>@import 'https://spy.example/'</style><img src="https://spy.example/pixel" onerror="alert(1)"><iframe src="https://spy.example/"></iframe><video poster="https://spy.example/pixel"></video><svg><a href="javascript:alert(1)">SVG</a></svg><form action="https://spy.example"><input name="password"></form><a href="https://example.com/" target="_blank" ping="https://spy.example" download>Normal</a>`
		),
		document()
	)!
	expect(fragment.querySelector('script,style,img,iframe,video,svg,math,form,input')).toBeNull()
	expect(fragment.querySelector('[onclick],[style],[target],[ping],[download],[src]')).toBeNull()
	expect(fragment.querySelector('a')?.getAttribute('href')).toBe('https://example.com/')
	expect(fragment.querySelector('a')?.getAttribute('rel')).toBe('noreferrer')
})
it('allows only credential-free HTTP(S) links, resolving relative links against the saved source', () => {
	const fragment = savedContent(
		asset(
			'<p>Links</p><a href="/next?q=1">Relative</a><a href="https://user:pass@example.com/">Secret</a><a href="javascript:alert(1)">Script</a><a href="data:text/html,x">Data</a><a href="mailto:me@example.com">Email</a>'
		),
		document(),
		'https://source.example/article'
	)!
	expect(Array.from(fragment.querySelectorAll('a[href]'), (a) => a.getAttribute('href'))).toEqual([
		'https://source.example/next?q=1'
	])
	expect(fragment.textContent).toContain('SecretScriptDataEmail')
})
it('namespaces footnotes and backlinks, removes unresolved fragments and avoids duplicate IDs', () => {
	const html =
		'<p id="ref">Citation <a href="#fn%201">1</a></p><p id="fn 1">Note <a href="#ref">Back</a></p><p id="fn 1">Duplicate</p><a href="#article-url">Missing</a><a href="#%xx">Malformed</a>'
	const doc = document(),
		fragment = savedContent(asset(html), doc)!,
		second = savedContent(asset(html), doc)!
	const ids = Array.from(fragment.querySelectorAll('[id]'), (e) => e.id)
	expect(ids).toHaveLength(2)
	expect(ids.every((id) => id.startsWith('clipper-reader-'))).toBe(true)
	expect(ids[0]).not.toBe(second.querySelector('[id]')?.id)
	expect(Array.from(fragment.querySelectorAll('a[href]'), (a) => a.getAttribute('href'))).toEqual([
		`#${ids[1]}`,
		`#${ids[0]}`
	])
	expect(fragment.querySelector('[id]')?.getAttribute('tabindex')).toBe('-1')
})
it('falls back to text for unavailable, unrelated, malformed, oversized or empty HTML assets', () => {
	const doc = document()
	const invalid: AssetResult[] = [
		{ kind: 'unavailable', reason: 'missing' },
		{ kind: 'available', mediaType: 'application/octet-stream', bytes: new Uint8Array([1]) },
		{ kind: 'available', mediaType: 'text/html', bytes: new Uint8Array([0xff]) },
		{ kind: 'available', mediaType: 'text/html', bytes: new Uint8Array(BYTE_LIMIT + 1) },
		asset('<img src="https://spy.example/">'),
		asset('')
	]
	for (const value of invalid) expect(savedContent(value, doc)).toBeUndefined()
})
it('rejects pathological element counts without discarding the stored text fallback', () => {
	expect(savedContent(asset('<br>'.repeat(50001) + 'Readable'), document())).toBeUndefined()
})
