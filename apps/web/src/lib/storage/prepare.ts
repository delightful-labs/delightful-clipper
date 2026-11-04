import type { PreparedSave, SaveRequest } from '../contracts/storage.js'
export { TEXT_LIMIT, BYTE_LIMIT } from './policy.js'
import { isBoundedSaveRequest, isBoundedSourceMetadata } from './policy.js'
const encoder = new TextEncoder()
async function hash(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
/** Domain intent fingerprint for reconciliation; Jazz owns byte storage and integrity. */
export async function prepareSave(libraryId: string, request: SaveRequest): Promise<PreparedSave> {
	const { operationId, title, text, mediaType } = request
	if (!isBoundedSaveRequest(request)) throw new Error('Invalid bounded storage request')
	if (!isBoundedSourceMetadata(request.source)) throw new Error('Invalid source metadata')
	const payload = new Uint8Array(request.bytes)
	const createdAt = new Date().toISOString()
	const payloadHash = await hash(
		encoder.encode(
			JSON.stringify([title, text, await hash(payload), mediaType, request.source ?? null])
		)
	)
	return {
		...(request.articleId ? { articleId: request.articleId } : {}),
		...(request.source
			? { source: { id: operationId, documentId: operationId, libraryId, ...request.source } }
			: {}),
		intent: { id: operationId, libraryId, payloadHash, createdAt },
		asset: { id: operationId, libraryId, operationId, mediaType, payload },
		snapshot: { id: operationId, libraryId, documentId: operationId, text, formatVersion: '1' },
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
