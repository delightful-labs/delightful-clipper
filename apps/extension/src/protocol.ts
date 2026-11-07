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
const accountIdentitySchema = z.strictObject({ accountId: z.uuid() })
export const acknowledgmentSchema = z.object({ accepted: z.boolean() })
export const acceptedAcknowledgmentSchema = acknowledgmentSchema.extend({
	accepted: z.literal(true)
})
export const captureSchema = z.strictObject({
	version: z.literal(1),
	id: z.uuid(),
	tabId: z.number().int().nonnegative(),
	documentId: z.string().min(1).max(128),
	url: sourceUrlSchema,
	phase: z.enum(['ready', 'issued']),
	accountId: accountIdentitySchema.shape.accountId.optional()
})
export type Capture = z.infer<typeof captureSchema>
export const messageSchema = captureSchema.pick({ id: true }).extend({ type: z.literal('CAPTURE') })
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

export const runSchema = captureSchema.pick({ id: true }).extend({
	target: z.literal('runtime'),
	type: z.literal('RUN'),
	accountId: accountIdentitySchema.shape.accountId
})
export const referenceMessageSchema = z.discriminatedUnion('type', [
	runSchema.pick({ id: true, accountId: true }).extend({ type: z.literal('ISSUE') }),
	captureSchema.pick({ id: true }).extend({ type: z.literal('REMOVE') })
])
export const progressSchema = z.strictObject({
	type: z.literal('PROGRESS'),
	capture: captureSchema,
	revision: z.number().int().nonnegative(),
	message: z.strictObject({ text: z.string().max(4096), variant: z.enum(['info', 'error']) }),
	articleId: z.uuid().optional()
})
export function backgroundSender(sender: chrome.runtime.MessageSender, id: string, page: string) {
	return sender.id === id && !sender.tab && (!sender.url || sender.url === page)
}

export const waitingSchema = progressSchema.pick({ revision: true, message: true }).extend({
	type: z.literal('WAITING'),
	id: captureSchema.shape.id
})

export const notificationSchema = z.union([waitingSchema, progressSchema])
export type NotificationMessage = z.infer<typeof notificationSchema>

export const accountChangedSchema = z.strictObject({
	type: z.literal('ACCOUNT_CHANGED'),
	accountId: accountIdentitySchema.shape.accountId
})
export const runtimeMessageSchema = z.union([
	runSchema,
	accountChangedSchema.extend({ target: runSchema.shape.target })
])

export const connectMessageSchema = z.strictObject({
	type: z.literal('CONNECT'),
	accountId: accountIdentitySchema.shape.accountId,
	requestId: z.uuid().optional()
})
export const authorizationRequestSchema = runSchema.omit({ id: true }).extend({
	type: z.literal('AUTHORIZE')
})
export function trustedAccountPage(
	sender: chrome.runtime.MessageSender,
	id: string,
	pages: string[]
) {
	return pages.some((page) => trustedSender(sender, id, page))
}
