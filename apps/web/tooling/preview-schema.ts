import { z } from 'zod'
import { uuidSchema, nonblankStringSchema } from '../src/lib/validation/values.ts'
export const previewAppSchema = z.object({ appId: uuidSchema, adminSecret: nonblankStringSchema() })
export type PreviewJazzApp = z.infer<typeof previewAppSchema>
