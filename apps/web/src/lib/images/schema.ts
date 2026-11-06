import { z } from 'zod'
import { uuidSchema } from '../validation/values.js'
import { normalizedSource, articleId } from '../capture/source.js'
export const IMAGE_INPUT_LIMIT = 4 * 1024 * 1024
export const IMAGE_OUTPUT_LIMIT = 2 * 1024 * 1024
export const IMAGE_EDGE = 2048
export const IMAGE_PIXELS = 40_000_000
export const imageUrlSchema = z
	.string()
	.max(8192)
	.transform((value, ctx) => {
		try {
			return normalizedSource(value)
		} catch {
			ctx.addIssue({ code: 'custom', message: 'Invalid image URL' })
			return z.NEVER
		}
	})
export const imageRowSchema = z.object({
	id: uuidSchema,
	libraryId: uuidSchema,
	documentId: uuidSchema,
	sourceUrl: imageUrlSchema,
	status: z.enum(['pending', 'ready', 'failed']),
	assetId: uuidSchema.nullable(),
	retryable: z.boolean()
})
export type ArticleImage = z.infer<typeof imageRowSchema>
export const processedImageSchema = z.object({
	bytes: z
		.instanceof(Uint8Array)
		.refine((bytes) => bytes.byteLength > 0 && bytes.byteLength <= IMAGE_OUTPUT_LIMIT),
	mediaType: z.enum(['image/png', 'image/webp']),
	width: z.number().int().min(1).max(IMAGE_EDGE),
	height: z.number().int().min(1).max(IMAGE_EDGE)
})
export const imageWorkerResultSchema = z.object({
	kind: z.literal('ready'),
	result: processedImageSchema
})
export type ProcessedImage = z.infer<typeof processedImageSchema>
export type ImageWrite = { image: ArticleImage } & (
	| { kind: 'ready'; result: ProcessedImage }
	| { kind: 'failed'; retryable: boolean }
)
/** Source URLs are inert encoded metadata, never a browser image source. */
export function imageSources(html: string) {
	const urls = new Set<string>()
	for (const match of html.matchAll(/<img\b[^>]*\bdata-clipper-image="([^"<>]*)"[^>]*>/gi)) {
		if (urls.size >= 250) break
		try {
			const parsed = imageUrlSchema.safeParse(decodeURIComponent(match[1] ?? ''))
			if (parsed.success) urls.add(parsed.data)
		} catch {
			/* Invalid metadata stays inert. */
		}
	}
	return [...urls]
}
export async function prepareImages(
	libraryId: string,
	documentId: string,
	html: string
): Promise<ArticleImage[]> {
	return Promise.all(
		imageSources(html).map(async (sourceUrl) => ({
			id: await articleId(documentId, sourceUrl),
			libraryId,
			documentId,
			sourceUrl,
			status: 'pending',
			assetId: null,
			retryable: true
		}))
	)
}
export function canAcquireImage(row: ArticleImage) {
	return row.status === 'pending' || (row.status === 'failed' && row.retryable)
}
export function canWriteImage(row: ArticleImage | null, draft: ImageWrite, intent: unknown) {
	return (
		!!row &&
		row.documentId === draft.image.documentId &&
		row.sourceUrl === draft.image.sourceUrl &&
		row.status !== 'ready' &&
		!intent
	)
}
