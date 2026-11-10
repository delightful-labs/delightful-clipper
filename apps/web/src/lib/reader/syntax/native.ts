import {
	MAX_CODE_BLOCKS,
	MAX_CODE_UNITS,
	codeLanguageSchema,
	type CodeBlock,
	type SyntaxRange
} from './schema.js'

export type CodeElement = { node: HTMLElement; block: CodeBlock }

export function codeElements(root: HTMLElement): CodeElement[] {
	const blocks: CodeElement[] = []
	let size = 0
	for (const node of root.querySelectorAll<HTMLElement>('pre > code, pre:not(:has(code))')) {
		const parent = node.parentElement!
		const language = [node, parent]
			.flatMap((element) => [
				[...element.classList].find((name) => name.startsWith('language-'))?.slice(9),
				element.getAttribute('data-language')
			])
			.find((value) => value)
		const text = node.textContent ?? ''
		const parsed = codeLanguageSchema.safeParse(language)
		if (!parsed.success || !text) continue
		if (text.length > MAX_CODE_UNITS || size + text.length > MAX_CODE_UNITS) continue
		blocks.push({ node, block: { language: parsed.data, text } })
		size += text.length
		if (blocks.length === MAX_CODE_BLOCKS) break
	}
	return blocks
}

export function supportsSyntaxHighlights(root: HTMLElement) {
	const view = root.ownerDocument.defaultView
	return !!view && typeof view.Highlight === 'function' && !!view.CSS?.highlights
}

/** Apply ranges to the existing text nodes. Tokenization never runs here. */
export function installSyntaxRanges(
	elements: readonly CodeElement[],
	tokens: readonly SyntaxRange[]
) {
	const document = elements[0]!.node.ownerDocument
	const view = document.defaultView!
	const owned: { name: string; highlight: Highlight; range: Range }[] = []
	const release = () => {
		for (const { name, highlight, range } of owned.splice(0)) {
			highlight.delete(range)
			if (!highlight.size && view.CSS.highlights.get(name) === highlight)
				view.CSS.highlights.delete(name)
		}
	}
	try {
		const nodes = elements.map(({ node, block }) => {
			if (!node.isConnected || node.textContent !== block.text)
				throw new Error('Syntax content detached')
			const walker = document.createTreeWalker(node, view.NodeFilter.SHOW_TEXT)
			const text: { node: Node; start: number; end: number }[] = []
			let offset = 0
			for (let current = walker.nextNode(); current; current = walker.nextNode()) {
				const end = offset + (current.textContent?.length ?? 0)
				text.push({ node: current, start: offset, end })
				offset = end
			}
			return text
		})
		for (const token of tokens) {
			const text = nodes[token.block]!
			const start = text.find((part) => part.end > token.start)
			const end = text.find((part) => part.end >= token.end)
			if (!start || !end) throw new Error('Syntax text boundary')
			const range = document.createRange()
			range.setStart(start.node, token.start - start.start)
			range.setEnd(end.node, token.end - end.start)
			const highlight = view.CSS.highlights.get(token.category) ?? new view.Highlight()
			highlight.add(range)
			owned.push({ name: token.category, highlight, range })
			view.CSS.highlights.set(token.category, highlight)
		}
	} catch (error) {
		release()
		throw error
	}
	return release
}
