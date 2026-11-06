import type { ReadingPosition } from './schema.js'
type Point = { node: Text; offset: number; length: number }
/** Version 1: Unicode code points with whitespace runs collapsed; original DOM nodes are unchanged. */
function isTextNode(node: Node): node is Text {
	return node.nodeType === node.TEXT_NODE
}
export function readingTextIndex(root: HTMLElement) {
	const points: Point[] = [],
		characters: string[] = []
	const walker = root.ownerDocument.createTreeWalker(root, 4)
	let node: Node | null
	let space: Point | undefined
	while ((node = walker.nextNode())) {
		if (!isTextNode(node)) continue
		const text = node
		let offset = 0
		for (const character of text.data) {
			const point = { node: text, offset, length: character.length }
			offset += character.length
			if (/\s/u.test(character)) {
				if (characters.length) space ??= point
				continue
			}
			if (space) {
				characters.push(' ')
				points.push(space)
				space = undefined
			}
			characters.push(character)
			points.push(point)
		}
	}
	return { characters, points }
}
export type ReadingTextIndex = ReturnType<typeof readingTextIndex>
export function quoteMatches(index: ReadingTextIndex, position: ReadingPosition) {
	const { characters } = index,
		{ offset, quote, prefix, suffix } = position
	const end = offset + Array.from(quote).length
	return (
		characters.slice(offset, end).join('') === quote &&
		characters.slice(Math.max(0, offset - Array.from(prefix).length), offset).join('') === prefix &&
		characters.slice(end, end + Array.from(suffix).length).join('') === suffix
	)
}
export function rangeAt(index: ReadingTextIndex, offset: number) {
	const point = index.points[offset]
	if (!point) return undefined
	const range = point.node.ownerDocument.createRange()
	range.setStart(point.node, point.offset)
	range.setEnd(point.node, point.offset + point.length)
	return range
}
export function positionAt(
	index: ReadingTextIndex,
	offset: number,
	progress: number,
	interactedAt = new Date().toISOString()
): ReadingPosition | undefined {
	if (!index.points[offset]) return undefined
	const end = Math.min(index.characters.length, offset + 80)
	return {
		version: 1,
		offset,
		quote: index.characters.slice(offset, end).join(''),
		prefix: index.characters.slice(Math.max(0, offset - 24), offset).join(''),
		suffix: index.characters.slice(end, end + 24).join(''),
		progress: Math.min(1, Math.max(0, progress)),
		interactedAt
	}
}
export function sameReadingLocation(a: ReadingPosition | undefined, b: ReadingPosition) {
	return a?.offset === b.offset && a.quote === b.quote && a.progress === b.progress
}
