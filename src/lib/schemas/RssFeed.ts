import { z } from 'zod'

const RssFeed = z.object({
  url: z.string().url().default(''),
  name: z.string().default(''),
  image: z.string().url().default(''),
  dateLastFetched: z.string().datetime(),
  dateAdded: z.string().datetime(),
  automaticTags: z.array(z.string()).default([])
})

export default RssFeed

export type RssFeed = z.infer<typeof RssFeed>