/** Feedback bounds for finite replies, never for an open reader/subscription. */
export const READER_REPLY_TIMEOUT_MS = 10_000
export type SearchWaitPolicy = { loadMs: number; indexMs: number; queryMs: number }
export const SEARCH_WAIT_POLICY: Readonly<SearchWaitPolicy> = Object.freeze({
	loadMs: 30_000,
	indexMs: 15_000,
	queryMs: 5_000
})
export const monotonicNow = () => performance.now()
/** Completion at the exact deadline is overdue, even before timer delivery. */
export function withinResourceDeadline(elapsedMs: number, deadlineMs: number) {
	return Number.isFinite(elapsedMs) && elapsedMs >= 0 && elapsedMs < deadlineMs
}
