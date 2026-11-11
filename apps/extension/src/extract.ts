import { Readability } from '@mozilla/readability'
import { featuredImageUrl } from '../../web/src/lib/capture/metadata.js'
import JSDOMParser from '@mozilla/readability/JSDOMParser.js'
import { sourceSchema, contentSchema, sameSource } from './protocol.js'
import { readableText } from '../../web/src/lib/reader/text.js'
// The pinned lightweight parser normally logs malformed source fragments. Reject without logging them.
class CaptureParser extends JSDOMParser {
	error() {
		throw new Error('invalidResponse')
	}
}

function fragment(href: string, source: { base: string; url: string }) {
	try {
		const url = new URL(href, source.base)
		if (sameSource(url.href, source.url)) return url.hash
	} catch {
		/* Invalid links are not anchor evidence. */
	}
	return ''
}

export function extractRenderedSource(value: unknown) {
	const source = sourceSchema.parse(value)
	const document = new CaptureParser().parse(source.html)
	Object.defineProperty(document, 'documentURI', { value: source.url })
	Object.defineProperty(document, 'baseURI', { value: source.base })
	const notes = new Map<string, string>()
	for (const link of document.getElementsByTagName('a')) {
		const href = fragment(link.getAttribute('href') ?? '', source)
		if (!href.startsWith('#') || href.length > 256 || notes.size >= 250) continue
		let id: string
		try {
			id = decodeURIComponent(href.slice(1))
		} catch {
			continue
		}
		const target = document.getElementById(id)
		if (target && /footnote|endnote|^fn\d|^note\d/i.test(id + ' ' + target.getAttribute('class'))) {
			const wrapper = document.createElement('div')
			wrapper.appendChild(target)
			notes.set(id, wrapper.innerHTML)
		}
	}
	const featuredImage = featuredImageUrl(document.getElementsByTagName('meta'), source.base)
	const article = new Readability(document, { maxElemsToParse: 50000 }).parse()
	if (!article?.content) throw new Error('captureFailed')
	const result = new CaptureParser().parse(`<html><body>${article.content}</body></html>`)
	for (const link of result.getElementsByTagName('a')) {
		const href = link.getAttribute('href') ?? ''
		try {
			const url = new URL(href, source.base)
			if (sameSource(url.href, source.url) && url.hash) link.setAttribute('href', url.hash)
		} catch {
			/* Rendering has its own sanitizer boundary. */
		}
	}
	for (const image of result.getElementsByTagName('img')) {
		image.removeAttribute('data-clipper-image')
		try {
			const url = new URL(image.getAttribute('src') ?? '', source.base)
			if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) continue
			image.setAttribute('data-clipper-image', encodeURIComponent(url.href))
		} catch {
			/* Unsupported sources remain inert in the reader. */
		}
	}
	let html = result.body.innerHTML
	for (const [id, note] of notes) {
		if (result.getElementById(id)) continue
		if (
			[...result.getElementsByTagName('a')].some((link) => link.getAttribute('href') === '#' + id)
		)
			html += note
	}
	const final = new CaptureParser().parse(`<html><body>${html}</body></html>`)
	return contentSchema.parse({
		title: article.title || new URL(source.url).hostname,
		text: readableText(final.body),
		excerpt: article.excerpt ?? readableText(final.body),
		author: article.byline ?? null,
		siteName: article.siteName ?? null,
		publishedTime: article.publishedTime ?? null,
		lang: article.lang ?? null,
		dir: article.dir ?? null,
		featuredImageUrl: featuredImage,
		html,
		finalUrl: source.url,
		provenance: JSON.stringify({
			type: 'browser-rendered',
			observedUrl: source.url,
			effectiveBase: source.base,
			parserVersion: 'readability-0.6.0',
			normalizationVersion: '1',
			redirects: 'unobserved',
			images: 'not-downloaded'
		})
	})
}
