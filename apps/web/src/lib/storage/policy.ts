import { z } from 'zod'
import { nonblankStringSchema, utf8StringSchema, uuidSchema } from '../validation/values.js'
export const TEXT_LIMIT = 64 * 1024
export const BYTE_LIMIT = 1024 * 1024
export const titleSchema = nonblankStringSchema(500)
export const mediaTypeSchema = nonblankStringSchema(150)
export const textSchema = utf8StringSchema(TEXT_LIMIT)
export const htmlSchema = utf8StringSchema(BYTE_LIMIT)
export const extractedTextSchema = textSchema.refine((value) => !!value.trim())
export const sourceMetadataSchema = z.object({
	finalUrl: z.string().max(8192),
	submittedUrl: z.string().max(8192),
	provenance: z.string().max(32768)
})
export const savePayloadSchema = z.object({
	operationId: uuidSchema,
	title: titleSchema,
	text: textSchema,
	bytes: z.instanceof(Uint8Array).refine((value) => value.byteLength <= BYTE_LIMIT),
	mediaType: mediaTypeSchema
})
export const saveRequestSchema = savePayloadSchema.extend({
	articleId: z.string().optional(),
	source: sourceMetadataSchema.optional()
})
export type SourceMetadata = z.infer<typeof sourceMetadataSchema>
export type SaveRequest = z.infer<typeof saveRequestSchema>
// Boolean adapters let existing actor guards reuse the same schemas without throwing/logging Zod errors.
export function isValidTitle(value: unknown): value is string {
	return titleSchema.safeParse(value).success
}
export function isValidMediaType(value: unknown): value is string {
	return mediaTypeSchema.safeParse(value).success
}
export function isBoundedText(value: unknown): value is string {
	return textSchema.safeParse(value).success
}
