import createDOMPurify, { type Config, type WindowLike } from 'dompurify'

const svgAttributes = [
	'viewbox',
	'preserveaspectratio',
	'width',
	'height',
	'x',
	'y',
	'x1',
	'y1',
	'x2',
	'y2',
	'cx',
	'cy',
	'r',
	'rx',
	'ry',
	'd',
	'points',
	'transform',
	'fill',
	'stroke',
	'stroke-width',
	'opacity',
	'fill-opacity',
	'stroke-opacity',
	'fill-rule',
	'stroke-linecap',
	'stroke-linejoin',
	'text-anchor',
	'font-size'
]
const htmlAttributes = new Set(['href', 'id', 'title', 'colspan', 'rowspan'])

/** Shared extraction/display allowlist: no active content or network-loading elements. */
export const articlePolicy = {
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
		'dd',
		'details',
		'summary',
		'svg',
		'g',
		'path',
		'rect',
		'circle',
		'ellipse',
		'line',
		'polyline',
		'polygon',
		'text',
		'tspan',
		'title',
		'desc'
	],
	ALLOWED_ATTR: ['href', 'id', 'title', 'colspan', 'rowspan', 'open', ...svgAttributes],
	ALLOW_DATA_ATTR: false,
	ALLOW_ARIA_ATTR: false
} satisfies Config

/** Static SVG only: no CSS, references, embedded HTML, images, filters or animation.
 * Geometry remains bounded by the article byte/node limits. Paints cannot load URLs.
 * Apply this hook at both extraction and display, including untrusted persisted assets.
 */
export function articlePurifier(window: WindowLike) {
	const purify = createDOMPurify(window)
	purify.addHook('uponSanitizeAttribute', (node, event) => {
		if (node.namespaceURI === 'http://www.w3.org/2000/svg') {
			const { attrName: name, attrValue: value } = event
			event.keepAttr = svgAttributes.includes(name) && value.length <= 16384
			if (name === 'fill' || name === 'stroke')
				event.keepAttr =
					event.keepAttr &&
					/^(?:none|currentColor|transparent|[a-z]{1,32}|#[a-f0-9]{3,8}|(?:rgb|rgba|hsl|hsla)\([0-9.,%+\-\s]+\))$/i.test(
						value
					)
		} else {
			event.keepAttr =
				htmlAttributes.has(event.attrName) ||
				(node.localName === 'details' && event.attrName === 'open')
		}
	})
	return purify
}
