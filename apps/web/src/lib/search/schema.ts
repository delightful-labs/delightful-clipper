import { z } from 'zod'
export const querySchema = z.string().max(512)
export const searchDocumentSchema = z.object({
	id: z.string().uuid(),
	title: z.string(),
	url: z.string(),
	text: z.string(),
	tags: z.string(),
	originalSavedAt: z.string()
})
export type SearchDocument = z.infer<typeof searchDocumentSchema>
