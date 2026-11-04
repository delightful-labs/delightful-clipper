import { z } from 'zod'
import { uuidSchema } from '../validation/values.js'
export const captureRequestSchema = z.strictObject({
	protocolVersion: z.literal(1),
	operationId: uuidSchema,
	url: z.string()
})
export type CaptureRequest = z.infer<typeof captureRequestSchema>
export type CaptureInput = Pick<CaptureRequest, 'operationId' | 'url'>
