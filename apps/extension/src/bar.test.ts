import { afterEach, expect, it, vi } from 'vitest'
import { JSDOM } from 'jsdom'
import { renderBar } from './bar.js'
import { serializePage } from './serialize.js'
afterEach(() => vi.unstubAllGlobals())
const view = {
	id: 'first',
	revision: 0,
	reset: true,
	text: 'Saving on this device…',
	variant: 'info' as const,
	href: 'https://clipper.test/',
	open: 'Open library',
	close: 'Close'
}
function fixture() {
	const dom = new JSDOM(
		'<html><body><article><h1>Original article</h1><p>Original text</p></article></body></html>',
		{ url: 'https://example.com/article', runScripts: 'outside-only' }
	)
	vi.stubGlobal('document', dom.window.document)
	vi.stubGlobal('HTMLElement', dom.window.HTMLElement)
	vi.stubGlobal('location', dom.window.location)
	vi.stubGlobal('XMLSerializer', dom.window.XMLSerializer)
	const render = renderBar
	return {
		dom,
		render,
		root: () => dom.window.document.querySelector('delightful-clipper-bar')?.shadowRoot
	}
}
it('keeps one bar, renders literal text, and rejects stale progress for this or a newer capture', () => {
	const f = fixture()
	f.render(view)
	f.render({ ...view, reset: false, revision: 2, text: '<script>literal status</script>' })
	f.render({ ...view, reset: false, revision: 1, text: 'Old status' })
	expect(f.root()?.textContent).toContain('<script>literal status</script>')
	expect(f.root()?.querySelector('script')).toBeNull()
	f.render({ ...view, id: 'next', text: 'Next capture' })
	f.render({ ...view, reset: false, revision: 100, text: 'Old capture' })
	expect(f.root()?.textContent).toContain('Next capture')
	expect(f.dom.window.document.querySelectorAll('delightful-clipper-bar')).toHaveLength(1)
	f.dom.window.close()
})
it('Close dismisses presentation and later progress cannot recreate it; capture omits the bar', () => {
	const f = fixture()
	f.render(view)
	const snapshot = serializePage()
	expect(snapshot.html).not.toContain('delightful-clipper-')
	expect(snapshot.html).toContain('Original article')
	f.root()?.querySelector('button')?.click()
	f.render({ ...view, reset: false, revision: 2, text: 'Article synced.' })
	expect(f.root()).toBeUndefined()
	expect(f.dom.window.document.querySelector('delightful-clipper-space')).toBeNull()
	expect(f.dom.window.document.querySelector('article')?.textContent).toBe(
		'Original articleOriginal text'
	)
	f.dom.window.close()
})
