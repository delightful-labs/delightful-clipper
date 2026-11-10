import { z } from 'zod'
import { articleMetadataSchema } from '../capture/metadata.js'
import { titleSchema, extractedTextSchema, htmlSchema } from '../storage/policy.js'
import { recordSchema } from '../validation/values.js'
export const resolutionResponseSchema = z.object({ operationId: z.string(), finalUrl: z.string() })
// Keep extraction evidence opaque; the retained title/text/HTML fields are bounded explicitly.
export const extractionEnvelopeSchema = z.looseObject({ candidate: recordSchema })
export const extractedContentSchema = z
	.looseObject({
		title: titleSchema,
		text: extractedTextSchema,
		html: htmlSchema
	})
	.extend(articleMetadataSchema.shape)
export const captureErrorSchema = z.object({
	code: z.enum([
		'invalidInput',
		'permissionDenied',
		'sessionUnavailable',
		'gatewayUnavailable',
		'rateLimited',
		'redirectBlocked',
		'redirectLoop',
		'fetchTimeout',
		'sourceUnavailable',
		'parseFailed',
		'sourceTooLarge',
		'unsupportedMedia',
		'canceled'
	])
})
