/** Stable gateway codes, with a bounded Retry-After delay; never raw upstream messages. */
export class ImageFetchError extends Error {
	constructor(
		code: string,
		readonly retryAfterMs = 0
	) {
		super(code)
	}
}
export function imageRetryDelay(error: unknown) {
	return error instanceof ImageFetchError ? error.retryAfterMs : 0
}
export function canRetryImageFetch(error: unknown) {
	return (
		!(error instanceof Error) ||
		![
			'unsupportedMedia',
			'sourceTooLarge',
			'redirectBlocked',
			'permissionDenied',
			'sessionUnavailable',
			'invalidResponse'
		].includes(error.message)
	)
}
export function retryAfterMilliseconds(header: string | null) {
	return header && /^\d{1,6}$/.test(header) ? Math.min(300000, Number(header) * 1000) : 0
}
