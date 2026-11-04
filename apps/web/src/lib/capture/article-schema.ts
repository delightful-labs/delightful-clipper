import { z } from 'zod'
import { lowercaseUuidSchema } from '../validation/values.js'
export const articleSchema = z.object({
	id: lowercaseUuidSchema,
	libraryId: z.string(),
	url: z.string().max(8192),
	originalSavedAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
	contentId: lowercaseUuidSchema.nullable(),
	operationId: lowercaseUuidSchema.nullable(),
	failure: z.string().max(100).nullable()
})
export type Article = z.infer<typeof articleSchema>
