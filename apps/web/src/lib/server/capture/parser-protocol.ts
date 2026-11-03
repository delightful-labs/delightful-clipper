import type { extract } from './extract.js'
export type ExtractedContent = Awaited<ReturnType<typeof extract>>
export type ParserReply =
	| { kind: 'success'; value: ExtractedContent }
	| { kind: 'failed'; code: string; status: number; retryable: boolean }
