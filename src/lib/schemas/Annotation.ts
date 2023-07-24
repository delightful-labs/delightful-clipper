import { z } from 'zod'

const TextQuoteSelector = z.object({
  type: z.literal('TextQuoteSelector').default('TextQuoteSelector'),
  exact: z.string(),
  prefix: z.string(),
  suffix: z.string()
})

const TextPositionSelector = z.object({
  type: z.literal('TextPositionSelector').default('TextPositionSelector'),
  start: z.number().positive(),
  end: z.number().positive(),
})

// @todo: add Creator
const Annotation = z.object({
  '@context': z.literal('http://www.w3.org/ns/anno.jsonld').default('http://www.w3.org/ns/anno.jsonld'),
  id: z.string().url().default(''),
  type: z.literal('Annotation').default('Annotation'),
  created: z.string().datetime({ offset: true }).default( new Date().toISOString() ),
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
  target: z.object({
    source: z.string().url(),
    selector: z.array(TextQuoteSelector.or(TextPositionSelector)).or(TextQuoteSelector).or(TextPositionSelector),
  }).or(z.string().url().default('')),
  body: z.object({
    type: z.literal('TextualBody').default('TextualBody'),
    value: z.string().default(''),
    format: z.string().default('text/html'),
    language: z.string().default('en')
  }).optional()
})

export default Annotation

export type Annotation = z.infer<typeof Annotation>