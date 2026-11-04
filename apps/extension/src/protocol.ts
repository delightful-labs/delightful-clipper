import { z } from 'zod'
import { normalizedSource } from '../../web/src/lib/capture/source.js'
import { extractedContentSchema } from '../../web/src/lib/contracts/capture-response.js'
export const sourceUrlSchema = z
	.string()
	.max(8192)
	.refine((value) => {
		try {
			normalizedSource(value)
			return true
		} catch {
			return false
		}
	})
export const captureSchema = z.strictObject({
	version: z.literal(1),
	id: z.uuid(),
	tabId: z.number().int().nonnegative(),
	documentId: z.string().min(1).max(128),
	url: sourceUrlSchema,
	phase: z.enum(['ready', 'issued']),
	accountId: z.uuid().optional()
})
export type Capture = z.infer<typeof captureSchema>
export const messageSchema = z.strictObject({ type: z.literal('CAPTURE'), id: z.uuid() })
export const sourceSchema = z.strictObject({
	url: sourceUrlSchema,
	base: sourceUrlSchema,
	html: z
		.string()
		.max(2 * 1024 * 1024)
		.refine((value) => new TextEncoder().encode(value).length <= 2 * 1024 * 1024)
})
export type Source = z.infer<typeof sourceSchema>
export const contentSchema = extractedContentSchema.extend({
	finalUrl: sourceUrlSchema,
	provenance: z.string().max(32768)
})
export const captureKey = (id: string) => `clipper.capture.${id}`
export function trustedSender(sender: chrome.runtime.MessageSender, id: string, page: string) {
	if (sender.id !== id || !sender.url || (sender.frameId ?? 0) !== 0) return false
	try {
		const url = new URL(sender.url)
		const expected = new URL(page)
		return (
			url.protocol === expected.protocol &&
			url.host === expected.host &&
			url.pathname === expected.pathname
		)
	} catch {
		return false
	}
}

export function sameSource(left: unknown, right: string) {
	const parsed = sourceUrlSchema.safeParse(left)
	return parsed.success && normalizedSource(parsed.data) === normalizedSource(right)
}
export function captureFor(value: unknown, id: string) {
	const parsed = captureSchema.safeParse(value)
	return parsed.success && parsed.data.id === id
}
export function matchingSource(value: unknown, capture: Capture) {
	const parsed = sourceSchema.safeParse(value)
	return parsed.success && sameSource(parsed.data.url, capture.url)
}

export function matchingContent(value: unknown, capture: Capture) {
	const parsed = contentSchema.safeParse(value)
	return parsed.success && sameSource(parsed.data.finalUrl, capture.url)
}
