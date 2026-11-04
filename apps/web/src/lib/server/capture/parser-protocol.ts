import { z } from 'zod'
import type { extract } from './extract.js'
export type ExtractedContent = Awaited<ReturnType<typeof extract>>
export type ParserReply =
	| { kind: 'success'; value: ExtractedContent }
	| { kind: 'failed'; code: string; status: number; retryable: boolean }

export const parserInputSchema = z.object({
	body: z.instanceof(Uint8Array).refine((value) => value.byteLength <= 10 * 1024 * 1024),
	mediaType: z.string(),
	url: z.string()
})
export type ParserInput = z.infer<typeof parserInputSchema>
