import { z } from 'zod'

const emptyString = z.literal('').default('')

const Username = z.object({
  full: z.string().default(''),
  hashed: z.string().default(''),
  trimmed: z.string().default(''),
})

export default Username

export type Username = z.infer<typeof Username>
