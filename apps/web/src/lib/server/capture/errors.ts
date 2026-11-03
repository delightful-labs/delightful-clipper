export class CaptureError extends Error {
	constructor(
		public readonly code: string,
		public readonly status: number,
		public readonly retryable = false
	) {
		super(code)
	}
}
