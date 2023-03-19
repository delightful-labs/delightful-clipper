import { z } from 'zod'

const Annotation = z.object({
  '@context': z.literal('http://www.w3.org/ns/anno.jsonld').default('http://www.w3.org/ns/anno.jsonld'),
  id: z.string().url().default(''),
  type: z.literal('Annotation').default('Annotation'),
  created: z.string().datetime({ offset: true }),
  modified: z.string().datetime({ offset: true }).optional(),
  motivation: z.enum([
    'assessing', 
    'bookmarking', 
    'classifying', 
    'commenting', 
    'describing', 
    'editing', 
    'highlighting', 
    'identifying',
    'linking',
    'moderating',
    'questioning',
    'replying',
    'tagging'
  ]).optional(),
  target: z.string().url().default(''),
  body: z.object({
    type: z.literal('TextualBody').default('TextualBody'),
    value: z.string().default(''),
    format: z.string().default('text/html'),
    language: z.string().default('en')
  }).optional()
})

export default Annotation

export type Annotation = z.infer<typeof Annotation>