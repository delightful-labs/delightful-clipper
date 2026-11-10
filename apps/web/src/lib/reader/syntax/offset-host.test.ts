import { afterEach, expect, it } from 'vitest'
import { createOffsetHighlighter } from './offset-host.js'
import { codeBlocksSchema, MAX_CODE_UNITS, syntaxRangesSchema } from './schema.js'

const globals = ['Range', 'Highlight', 'CSS', 'Node'].map((name) => ({
	name,
	descriptor: Object.getOwnPropertyDescriptor(globalThis, name)
}))
afterEach(() => {
	for (const { name, descriptor } of globals) {
		if (descriptor) Object.defineProperty(globalThis, name, descriptor)
		else Reflect.deleteProperty(globalThis, name)
	}
})

it('uses the real MicroLighter scanner for aliases, Unicode and multiple language grammars without a DOM', async () => {
	const highlight = createOffsetHighlighter()
	const blocks = [
		{ language: 'js', text: 'const fox = "🦊"; // café' },
		{ language: 'py', text: 'def greet():\n    return 42' },
		{ language: 'json', text: '{"ready": true}' }
	]
	const ranges = syntaxRangesSchema.parse(await highlight(blocks))
	const text = ranges.map((range) => ({
		category: range.category,
		block: range.block,
		text: blocks[range.block]!.text.slice(range.start, range.end)
	}))
	expect(text).toContainEqual({ block: 0, category: 'storage', text: 'const' })
	expect(text.some((token) => token.block === 0 && token.text.includes('🦊'))).toBe(true)
	expect(text.some((token) => token.block === 1 && token.text === '42')).toBe(true)
	expect(text.some((token) => token.block === 2 && token.text === 'true')).toBe(true)
})

it('leaves unknown languages plain and does not retain ranges from the previous request', async () => {
	const highlight = createOffsetHighlighter()
	expect(await highlight([{ language: 'js', text: 'const value = 42' }])).not.toEqual([])
	expect(
		await highlight([{ language: 'unsupported-clipper-language', text: 'plain text' }])
	).toEqual([])
})

it('bounds whole requests and rejects source paths or invalid token ranges', () => {
	expect(codeBlocksSchema.safeParse([{ language: '../../evil', text: 'x' }]).success).toBe(false)
	expect(
		codeBlocksSchema.safeParse([
			{ language: 'js', text: 'a'.repeat(MAX_CODE_UNITS) },
			{ language: 'js', text: 'b' }
		]).success
	).toBe(false)
	expect(
		syntaxRangesSchema.safeParse([{ block: 0, category: 'keyword', start: 5, end: 4 }]).success
	).toBe(false)
})
