import type { PreparedSave, SaveRequest } from '../contracts/storage.js'
export const TEXT_LIMIT = 64 * 1024
export const BYTE_LIMIT = 1024 * 1024
const encoder = new TextEncoder()
async function hash(bytes: Uint8Array): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new Uint8Array(bytes))
	return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('')
}
/** Domain intent fingerprint for reconciliation; Jazz owns byte storage and integrity. */
export async function prepareSave(libraryId: string, request: SaveRequest): Promise<PreparedSave> {
	const { operationId, title, text, mediaType } = request
	if (
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(operationId) ||
		!title.trim() ||
		title.length > 500 ||
		!mediaType.trim() ||
		mediaType.length > 150 ||
		encoder.encode(text).byteLength > TEXT_LIMIT ||
		request.bytes.byteLength > BYTE_LIMIT
	)
		throw new Error('Invalid bounded storage request')
	const payload = new Uint8Array(request.bytes)
	const createdAt = new Date().toISOString()
	const payloadHash = await hash(
		encoder.encode(JSON.stringify([title, text, await hash(payload), mediaType]))
	)
	return {
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
