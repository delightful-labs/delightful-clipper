const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isUuid(value: unknown): value is string {
	return typeof value === 'string' && uuidPattern.test(value)
}
export function isLowercaseUuid(value: unknown): value is string {
	return isUuid(value) && value === value.toLowerCase()
}
export function isNonblankString(value: unknown, maxCharacters: number): value is string {
	return typeof value === 'string' && !!value.trim() && value.length <= maxCharacters
}
export function isUtf8WithinLimit(value: unknown, maxBytes: number): value is string {
	return typeof value === 'string' && new TextEncoder().encode(value).byteLength <= maxBytes
}
export function usesHttpProtocol(url: URL) {
	return ['http:', 'https:'].includes(url.protocol)
}
export function hasCredentials(url: URL) {
	return !!url.username || !!url.password
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value)
}
