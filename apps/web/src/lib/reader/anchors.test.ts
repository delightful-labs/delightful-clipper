import { JSDOM } from 'jsdom'
import { expect, it } from 'vitest'
import { readingTextIndex, positionAt, quoteMatches, rangeAt } from './anchors.js'
it('indexes normalized Unicode code points across markup without modifying the source or losing UTF-16 ranges', () => {
	const document = new JSDOM('<div>  A  <em>😀 é</em>\nlast </div>').window.document
	const root = document.querySelector('div')!,
		before = root.innerHTML
	const index = readingTextIndex(root)
	expect(index.characters.join('')).toBe('A 😀 é last')
	expect(root.innerHTML).toBe(before)
	const position = positionAt(index, 2, 0.2)!
	expect(position.quote).toBe('😀 é last')
	expect(rangeAt(index, 2)?.toString()).toBe('😀')
	expect(quoteMatches(index, position)).toBe(true)
	expect(quoteMatches(index, { ...position, quote: 'different' })).toBe(false)
	expect(quoteMatches(index, { ...position, prefix: 'wrong' })).toBe(false)
	expect(positionAt(index, 999, 1)).toBeUndefined()
})
it('verifies context instead of silently relocating a repeated or changed quote', () => {
	const document = new JSDOM('<div>Before repeated after. Other repeated end.</div>').window
		.document
	const index = readingTextIndex(document.querySelector('div')!)
	const position = positionAt(index, 7, 0.3)!
	expect(quoteMatches(index, { ...position, offset: 29 })).toBe(false)
})
