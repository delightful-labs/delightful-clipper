import { z } from 'zod'
// Preserve the accepted UUID syntax, including content-derived IDs and uppercase operation IDs.
export const uuidSchema = z
	.string()
	.regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
export const lowercaseUuidSchema = uuidSchema.refine((value) => value === value.toLowerCase())
export const recordSchema = z.record(z.string(), z.unknown())
const encoder = new TextEncoder()
function hasNonblankText(value: string) {
	return !!value.trim()
}
export function nonblankStringSchema(maxCharacters = Number.MAX_SAFE_INTEGER) {
	return z.string().max(maxCharacters).refine(hasNonblankText)
}
/** A named refinement keeps UTF-8 byte bounds distinct from string character limits. */
export function utf8StringSchema(maxBytes: number) {
	return z.string().refine((value) => encoder.encode(value).byteLength <= maxBytes)
}
export function isUuid(value: unknown): value is string {
	return uuidSchema.safeParse(value).success
}
export function usesHttpProtocol(url: URL) {
	return ['http:', 'https:'].includes(url.protocol)
}
export function hasCredentials(url: URL) {
	return !!url.username || !!url.password
}
