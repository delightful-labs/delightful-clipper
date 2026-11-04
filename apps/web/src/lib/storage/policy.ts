import type { SaveRequest } from '../contracts/storage.js'
import { isNonblankString, isUtf8WithinLimit, isUuid } from '../validation/values.js'
export const TEXT_LIMIT = 64 * 1024
export const BYTE_LIMIT = 1024 * 1024
export function isValidTitle(value: unknown): value is string {
	return isNonblankString(value, 500)
}
export function isValidMediaType(value: unknown): value is string {
	return isNonblankString(value, 150)
}
export function isBoundedText(value: unknown): value is string {
	return isUtf8WithinLimit(value, TEXT_LIMIT)
}
export function isBoundedHtml(value: unknown): value is string {
	return isUtf8WithinLimit(value, BYTE_LIMIT)
}
export function isValidExtractedText(value: unknown): value is string {
	return isBoundedText(value) && !!value.trim()
}
export function isBoundedSaveRequest(request: SaveRequest) {
	if (!isUuid(request.operationId)) return false
	if (!isValidTitle(request.title)) return false
	if (!isValidMediaType(request.mediaType)) return false
	return isBoundedText(request.text) && request.bytes.byteLength <= BYTE_LIMIT
}
export function isBoundedSourceMetadata(source: SaveRequest['source']) {
	if (!source) return true
	if (source.finalUrl.length > 8192) return false
	if (source.submittedUrl.length > 8192) return false
	return source.provenance.length <= 32768
}
