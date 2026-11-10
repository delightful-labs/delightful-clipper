import { expect, it } from 'vitest'
import { EXCERPT_BYTES, EXCERPT_GRAPHEMES, excerptSchema, makeExcerpt } from './excerpt.js'

it('normalizes saved text, removes a repeated title and preserves short content', () => {
	expect(makeExcerpt('  Title\n First   paragraph\twith useful text. ', 'Title')).toBe(
		'First paragraph with useful text.'
	)
	expect(makeExcerpt('Title', 'Title')).toBe('')
	expect(makeExcerpt('  \n\t')).toBe('')
	expect(makeExcerpt('Titles stay intact.', 'Title')).toBe('Titles stay intact.')
})

it('bounds long previews at a word boundary without changing their source', () => {
	const text = 'A readable sentence about saved articles. '.repeat(100)
	const result = makeExcerpt(text)
	expect(result.endsWith('…')).toBe(true)
	expect(result.endsWith(' …')).toBe(false)
	expect(result.length).toBeLessThanOrEqual(EXCERPT_GRAPHEMES)
	expect(text.startsWith(result.slice(0, -1))).toBe(true)
	expect(excerptSchema.safeParse(result).success).toBe(true)
})

it('keeps whole emoji graphemes and honors the independent UTF-8 byte cap', () => {
	const family = '👩‍👩‍👧‍👦'
	const result = makeExcerpt(family.repeat(200))
	expect(result.endsWith('…')).toBe(true)
	expect(result.slice(0, -1).replaceAll(family, '')).toBe('')
	expect(new TextEncoder().encode(result).byteLength).toBeLessThanOrEqual(EXCERPT_BYTES)
	expect(excerptSchema.safeParse(result).success).toBe(true)
	expect(excerptSchema.parse('x'.repeat(5000))).toHaveLength(5000)
	expect(excerptSchema.safeParse('x'.repeat(1024 * 1024 + 1)).success).toBe(false)
})
