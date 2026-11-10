import { z } from 'zod'
import { utf8StringSchema, usesHttpProtocol, hasCredentials } from '../validation/values.js'
import { excerptSchema } from './excerpt.js'

// Source-size limits still apply. Retained metadata is never silently shortened.
const metadataTextSchema = utf8StringSchema(1024 * 1024)
export const featuredImageUrlSchema = z
	.string()
	.max(8192)
	.transform((value, ctx) => {
		try {
			const url = new URL(value)
			if (!usesHttpProtocol(url) || hasCredentials(url)) throw new Error('invalidUrl')
			url.hash = ''
			return url.href
		} catch {
			ctx.addIssue({ code: 'custom', message: 'Invalid featured image URL' })
			return z.NEVER
		}
	})
export const captureDetailsSchema = z.object({
	author: metadataTextSchema.nullish(),
	siteName: metadataTextSchema.nullish(),
	publishedTime: metadataTextSchema.nullish(),
	lang: metadataTextSchema.nullish(),
	dir: metadataTextSchema.nullish(),
	featuredImageUrl: featuredImageUrlSchema.nullish()
})
export const articleMetadataSchema = captureDetailsSchema.extend({
	excerpt: excerptSchema.nullish()
})
export type ArticleMetadata = z.infer<typeof articleMetadataSchema>

/** Read before Readability mutates the source document; never fetch from this adapter. */
export function featuredImageUrl(
	metas: Iterable<{ getAttribute(name: string): string | null }>,
	base: string
): string | null {
	const candidates = new Map<string, string[]>()
	for (const meta of metas) {
		const key = (meta.getAttribute('property') || meta.getAttribute('name') || '')
			.trim()
			.toLowerCase()
		const value = meta.getAttribute('content')
		if (value && ['og:image', 'twitter:image', 'twitter:image:src'].includes(key)) {
			const values = candidates.get(key) ?? []
			values.push(value)
			candidates.set(key, values)
		}
	}
	for (const key of ['og:image', 'twitter:image', 'twitter:image:src'])
		for (const candidate of candidates.get(key) ?? []) {
			try {
				const result = featuredImageUrlSchema.safeParse(new URL(candidate, base).href)
				if (result.success) return result.data
			} catch {
				/* Unsupported metadata is absent; article capture can still succeed. */
			}
		}
	return null
}
