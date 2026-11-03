import { JSDOM } from 'jsdom'
import { Readability } from '@mozilla/readability'
import createDOMPurify from 'dompurify'
import { CaptureError } from './errors.js'
import { sourceUrl } from './destination.js'
export function extract(body: Uint8Array, mediaType: string, url: string) {
	if (!/^(text\/html|application\/xhtml\+xml|text\/plain)(;|$)/i.test(mediaType))
		throw new CaptureError('unsupportedMedia', 415)
	const plain = /^text\/plain/i.test(mediaType)
	let text = ''
	if (plain) {
		try {
			text = new TextDecoder(mediaType.match(/charset=["']?([^;"'\s]+)/i)?.[1] ?? 'utf-8').decode(
				body
			)
		} catch {
			throw new CaptureError('unsupportedMedia', 415)
		}
	}
	const dom = plain
		? new JSDOM('<article><pre></pre></article>', { url })
		: new JSDOM(Buffer.from(body), { url, contentType: mediaType })
	try {
		const document = dom.window.document
		if (/^text\/plain/i.test(mediaType)) {
			const pre = document.querySelector('pre')
			if (pre) pre.textContent = text
		}
		if (document.querySelectorAll('*').length > 50000) throw new CaptureError('sourceTooLarge', 413)
		// Preserve referenced footnote targets before Readability prunes the source DOM.
		const notes = new Map<string, string>()
		for (const link of document.querySelectorAll('a[href]')) {
			const href = link.getAttribute('href')
			if (!href?.startsWith('#') || href.length > 256 || notes.size >= 250) continue
			let id: string
			try {
				id = decodeURIComponent(href.slice(1))
			} catch {
				continue
			}
			const target = document.getElementById(id)
			if (target && /footnote|endnote|^fn\d|^note\d/i.test(id + ' ' + target.className))
				notes.set(id, target.outerHTML)
		}
		const canonical = document.querySelector('link[rel="canonical"]')?.getAttribute('href')
		let canonicalCandidate: string | undefined
		if (canonical)
			try {
				canonicalCandidate = sourceUrl(new URL(canonical, url).href).href
			} catch {
				/* Evidence is optional; never changes identity. */
			}
		const article = /^text\/plain/i.test(mediaType)
			? { title: new URL(url).hostname, byline: null, content: document.body.innerHTML }
			: new Readability(document, { maxElemsToParse: 50000 }).parse()
		if (!article?.content) throw new CaptureError('parseFailed', 422)
		const result = new JSDOM(article.content, { url })
		try {
			const root = result.window.document
			for (const link of root.querySelectorAll('a[href]')) {
				try {
					const target = new URL(link.getAttribute('href') ?? '', url)
					const base = new URL(url)
					if (
						target.origin === base.origin &&
						target.pathname === base.pathname &&
						target.search === base.search &&
						target.hash
					)
						link.setAttribute('href', target.hash)
				} catch {
					/* Invalid links are removed below. */
				}
			}
			for (const [id, html] of notes)
				if (
					!root.getElementById(id) &&
					Array.from(root.querySelectorAll('a[href]')).some(
						(link) => link.getAttribute('href') === `#${id}`
					)
				)
					root.body.insertAdjacentHTML('beforeend', html)
			const images = root.querySelectorAll('img[src]')
			const assetCandidates = Array.from(images)
				.slice(0, 250)
				.flatMap((img) => {
					try {
						return [
							{
								sourceUrl: sourceUrl(new URL(img.getAttribute('src') ?? '', url).href).href,
								alt: img.getAttribute('alt') ?? ''
							}
						]
					} catch {
						return []
					}
				})
			for (const link of root.querySelectorAll('a[href]')) {
				const href = link.getAttribute('href') ?? ''
				if (!href.startsWith('#'))
					try {
						link.setAttribute('href', sourceUrl(new URL(href, url).href).href)
					} catch {
						link.removeAttribute('href')
					}
			}
			const purify = createDOMPurify(result.window)
			const html = purify.sanitize(root.body.innerHTML, {
				ALLOWED_TAGS: [
					'article',
					'section',
					'p',
					'h1',
					'h2',
					'h3',
					'h4',
					'h5',
					'h6',
					'ul',
					'ol',
					'li',
					'a',
					'sup',
					'sub',
					'em',
					'strong',
					'b',
					'i',
					'blockquote',
					'pre',
					'code',
					'br',
					'hr',
					'table',
					'thead',
					'tbody',
					'tr',
					'th',
					'td',
					'figure',
					'figcaption',
					'dl',
					'dt',
					'dd'
				],
				ALLOWED_ATTR: ['href', 'id', 'title', 'colspan', 'rowspan'],
				ALLOW_DATA_ATTR: false,
				ALLOW_ARIA_ATTR: false
			})
			root.body.innerHTML = html
			const blocks = new Set([
				'P',
				'DIV',
				'ARTICLE',
				'SECTION',
				'H1',
				'H2',
				'H3',
				'H4',
				'H5',
				'H6',
				'LI',
				'UL',
				'OL',
				'BLOCKQUOTE',
				'PRE',
				'TR',
				'FIGCAPTION',
				'DL',
				'DT',
				'DD'
			])
			function project(node: Node): string {
				if (node.nodeType === 3) return node.textContent ?? ''
				if (node.nodeType !== 1) return ''
				const tag = node.nodeName
				if (tag === 'BR') return '\n'
				const value = Array.from(node.childNodes, project).join('')
				return blocks.has(tag) ? `\n${value}\n` : value
			}
			const normalizedText = project(root.body)
				.replace(/\n{3,}/g, '\n\n')
				.trim()
			if (!normalizedText) throw new CaptureError('parseFailed', 422)
			return {
				canonicalCandidate,
				candidate: {
					title: article.title || new URL(url).hostname,
					author: article.byline ?? undefined,
					html,
					text: normalizedText,
					headings: Array.from(root.querySelectorAll('h1,h2,h3,h4,h5,h6'), (heading) => ({
						text: heading.textContent ?? '',
						level: Number(heading.tagName.slice(1)),
						id: heading.id
					})),
					footnotes: Array.from(notes.keys()).filter((id) => root.getElementById(id)),
					assetCandidates,
					parserVersion: 'readability-0.6.0',
					normalizationVersion: '1',
					partialEvidence: [
						...(assetCandidates.length ? ['assetsNotFetched'] : []),
						...(images.length > 250 ? ['assetCandidateLimit'] : []),
						...(notes.size >= 250 ? ['footnoteLimit'] : [])
					]
				}
			}
		} finally {
			result.window.close()
		}
	} finally {
		dom.window.close()
	}
}
