import { z } from 'zod'
import { querySchema, searchDocumentSchema } from './schema.js'
const generationSchema = z.object({ generation: z.number().int().nonnegative() })
const queryMessageSchema = generationSchema.extend({ query: querySchema })
export const searchWorkerInputSchema = z.discriminatedUnion('type', [
	generationSchema.extend({
		type: z.literal('INDEX'),
		key: z.string().min(1).max(512),
		documents: z.array(searchDocumentSchema)
	}),
	queryMessageSchema.extend({ type: z.literal('QUERY') })
])
export type SearchWorkerInput = z.infer<typeof searchWorkerInputSchema>
export const searchWorkerOutputSchema = z.discriminatedUnion('type', [
	generationSchema.extend({ type: z.literal('INDEX_READY') }),
	queryMessageSchema.extend({
		type: z.literal('RESULT'),
		ids: z.array(searchDocumentSchema.shape.id)
	}),
	z.object({ type: z.literal('WORKER_ERROR') })
])
export type SearchWorkerOutput = z.infer<typeof searchWorkerOutputSchema>
