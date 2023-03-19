import { z } from 'zod'
import Annotation from './Annotation'

const AnnotationCollection = z.object({
  '@context': z.literal('http://www.w3.org/ns/anno.jsonld').default('http://www.w3.org/ns/anno.jsonld'),
  id: z.string().url().default(''),
  type: z.literal('AnnotationCollection').default('AnnotationCollection'),
  label: z.string().default(''),
  total: z.number().default(1),
  first: z.object({
    id: z.string().url().default(''),
    type: z.literal('AnnotationPage').default('AnnotationPage'),
    startIndex: z.number().default(0),
    items: z.array(Annotation).default([])
  }).default({})
})

export default AnnotationCollection

export type AnnotationCollection = z.infer<typeof AnnotationCollection>