import { prepareImages } from '../images/schema.js'
import { captureDetailsSchema } from '../capture/metadata.js'
import type { PreparedSave, SaveRequest } from '../contracts/storage.js'
export { TEXT_LIMIT, BYTE_LIMIT } from './policy.js'
import { saveRequestSchema } from './policy.js'
const encoder = new TextEncoder()
async function hash(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
/** Domain intent fingerprint for reconciliation; Jazz owns byte storage and integrity. */
export async function prepareSave(libraryId: string, request: SaveRequest): Promise<PreparedSave> {
	const parsed = saveRequestSchema.safeParse(request)
	if (!parsed.success) {
		const sourceOnly = parsed.error.issues.every((issue) => issue.path[0] === 'source')
		throw new Error(sourceOnly ? 'Invalid source metadata' : 'Invalid bounded storage request')
	}
	const { operationId, title, text, mediaType } = parsed.data
	const input = parsed.data
	const excerpt = input.excerpt ?? text
	const details = captureDetailsSchema.parse(input)
	const hasDetails = Object.values(details).some((value) => value !== undefined)
	const payload = new Uint8Array(input.bytes)
	const fingerprintSource = request.source ? { ...request.source } : null
	const createdAt = new Date().toISOString()
	const payloadHash = await hash(
		encoder.encode(
			// Preserve the legacy metadata key order in durable intent fingerprints.
			JSON.stringify([
				title,
				text,
				await hash(payload),
				mediaType,
				fingerprintSource,
				...(input.excerpt === undefined ? [] : [excerpt]),
				...(hasDetails ? [details] : [])
			])
		)
	)
	return {
		images:
			mediaType === 'text/html'
				? await prepareImages(
						libraryId,
						operationId,
						new TextDecoder().decode(payload),
						input.featuredImageUrl
					)
				: [],
		...(input.articleId ? { articleId: input.articleId } : {}),
		...(input.source
			? { source: { id: operationId, documentId: operationId, libraryId, ...input.source } }
			: {}),
		intent: { id: operationId, libraryId, payloadHash, createdAt },
		asset: { id: operationId, libraryId, operationId, mediaType, payload },
		snapshot: {
			id: operationId,
			libraryId,
			documentId: operationId,
			text,
			excerpt,
			author: details.author ?? null,
			siteName: details.siteName ?? null,
			publishedTime: details.publishedTime ?? null,
			lang: details.lang ?? null,
			dir: details.dir ?? null,
			featuredImageUrl: details.featuredImageUrl ?? null,
			formatVersion: '1'
		},
		document: {
			id: operationId,
			libraryId,
			operationId,
			snapshotId: operationId,
			assetId: operationId,
			title,
			originalSavedAt: createdAt
		}
	}
}
