import { highlightAll } from 'microlighter'
import { MAX_SYNTAX_RANGES, type CodeBlock, type SyntaxRange } from './schema.js'

type CodeText = { data: string; block: number; nodeType: number; nextSibling: null }

/** MicroLighter 2.2's public scanner writes to Range/Highlight. In this isolated
 * worker those capabilities collect UTF-16 offsets; they never touch a DOM.
 * Keep this compatibility surface pinned and qualify it against the real package.
 */
export function createOffsetHighlighter() {
	let count = 0
	class OffsetRange {
		node: CodeText | undefined
		start = 0
		end = 0
		constructor() {
			if (++count > MAX_SYNTAX_RANGES) throw new Error('Syntax range limit')
		}
		setStart(node: CodeText, offset: number) {
			this.node = node
			this.start = offset
		}
		setEnd(node: CodeText, offset: number) {
			if (node !== this.node) throw new Error('Syntax text boundary')
			this.end = offset
		}
	}
	const registry = new Map<string, Set<OffsetRange>>()
	Object.defineProperties(globalThis, {
		Range: { value: OffsetRange, configurable: true },
		Highlight: { value: Set, configurable: true },
		CSS: { value: { highlights: registry }, configurable: true },
		Node: { value: { TEXT_NODE: 3 }, configurable: true }
	})

	return async (blocks: readonly CodeBlock[]): Promise<SyntaxRange[]> => {
		count = 0
		registry.clear()
		const code = blocks.map((block, index) => ({
			classList: [`language-${block.language}`],
			dataset: {},
			parentElement: { classList: [], dataset: {}, getAttribute: () => null },
			firstChild: { data: block.text, block: index, nodeType: 3, nextSibling: null },
			normalize() {}
		}))
		// The adapter implements the scanner's read-only node capabilities, rather
		// than shipping a DOM emulator or changing MicroLighter's tokenizer.
		const root = { querySelectorAll: () => code }
		await Reflect.apply(highlightAll, undefined, [{ root }])
		return [...registry].flatMap(([category, ranges]) =>
			[...ranges].flatMap((range) =>
				range.node
					? [{ block: range.node.block, category, start: range.start, end: range.end }]
					: []
			)
		)
	}
}
