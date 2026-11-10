import { utf8StringSchema } from '../validation/values.js'

export const EXCERPT_GRAPHEMES = 240
export const EXCERPT_BYTES = 1024
export const EXCERPT_SOURCE_LIMIT = 4096
export const excerptSchema = utf8StringSchema(1024 * 1024)
const encoder = new TextEncoder()
const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' })

/** Display projection only. Never use this result as the retained parser excerpt. */
export function makeExcerpt(text: string, title = ''): string {
	let normalized = text.slice(0, EXCERPT_SOURCE_LIMIT).replace(/\s+/gu, ' ').trim()
	const heading = title.replace(/\s+/gu, ' ').trim()
	if (heading && (normalized === heading || normalized.startsWith(heading + ' ')))
		normalized = normalized.slice(heading.length).trimStart()
	const parts: string[] = []
	let bytes = 0
	let truncated = false
	for (const { segment } of segmenter.segment(normalized)) {
		const length = encoder.encode(segment).byteLength
		if (parts.length >= EXCERPT_GRAPHEMES || bytes + length > EXCERPT_BYTES) {
			truncated = true
			break
		}
		parts.push(segment)
		bytes += length
	}
	if (!truncated) return parts.join('').trimEnd()
	while (parts.length && (parts.length >= EXCERPT_GRAPHEMES || bytes > EXCERPT_BYTES - 3)) {
		bytes -= encoder.encode(parts.pop() ?? '').byteLength
	}
	let excerpt = parts.join('').trimEnd()
	const word = excerpt.lastIndexOf(' ')
	if (word > excerpt.length * 0.75) excerpt = excerpt.slice(0, word)
	return excerpt ? excerpt + '…' : ''
}
