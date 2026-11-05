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

export function readableText(root: Node) {
	return project(root)
		.replace(/\n{3,}/g, '\n\n')
		.trim()
}
