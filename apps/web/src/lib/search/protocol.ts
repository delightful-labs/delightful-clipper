import { z } from 'zod'
import { querySchema, searchDocumentSchema } from './schema.js'
export const searchWorkerInputSchema = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('INDEX'),
		key: z.string().min(1).max(512),
		generation: z.number().int().nonnegative(),
		documents: z.array(searchDocumentSchema)
	}),
	z.object({
		type: z.literal('QUERY'),
		generation: z.number().int().nonnegative(),
		query: querySchema
	})
])
export type SearchWorkerInput = z.infer<typeof searchWorkerInputSchema>
export const searchWorkerOutputSchema = z.discriminatedUnion('type', [
	z.object({ type: z.literal('INDEX_READY'), generation: z.number().int().nonnegative() }),
	z.object({
		type: z.literal('RESULT'),
		generation: z.number().int().nonnegative(),
		query: querySchema,
		ids: z.array(z.string().uuid())
	}),
	z.object({ type: z.literal('WORKER_ERROR') })
])
export type SearchWorkerOutput = z.infer<typeof searchWorkerOutputSchema>
