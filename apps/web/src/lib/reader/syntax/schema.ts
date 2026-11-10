import { z } from 'zod'

export const MAX_CODE_BLOCKS = 32
export const MAX_CODE_UNITS = 65536
export const MAX_SYNTAX_RANGES = 6000

export const codeLanguageSchema = z.string().regex(/^[a-z0-9_-]{1,32}$/)
export const codeBlockSchema = z.object({
	language: codeLanguageSchema,
	text: z.string().max(MAX_CODE_UNITS)
})
export const codeBlocksSchema = z
	.array(codeBlockSchema)
	.max(MAX_CODE_BLOCKS)
	.refine((blocks) => blocks.reduce((size, block) => size + block.text.length, 0) <= MAX_CODE_UNITS)
export type CodeBlock = z.infer<typeof codeBlockSchema>

export const syntaxRangeSchema = z
	.object({
		block: z
			.number()
			.int()
			.min(0)
			.max(MAX_CODE_BLOCKS - 1),
		category: z.string().regex(/^[a-z][a-z-]{0,31}$/),
		start: z.number().int().min(0).max(MAX_CODE_UNITS),
		end: z.number().int().min(1).max(MAX_CODE_UNITS)
	})
	.refine((range) => range.end > range.start)
export const syntaxRangesSchema = z.array(syntaxRangeSchema).max(MAX_SYNTAX_RANGES)
export type SyntaxRange = z.infer<typeof syntaxRangeSchema>
export const syntaxReplySchema = z.discriminatedUnion('kind', [
	z.object({ kind: z.literal('ready'), ranges: syntaxRangesSchema }),
	z.object({ kind: z.literal('failed') })
])

export function rangesMatchBlocks(ranges: readonly SyntaxRange[], blocks: readonly CodeBlock[]) {
	return ranges.every((range) => range.end <= (blocks[range.block]?.text.length ?? 0))
}
