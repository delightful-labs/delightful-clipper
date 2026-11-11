/** Feedback bounds for local shutdown. Expiry retains the original owner/effect. */
export const REALM_CLOSE_POLICY: Readonly<{
	drainMs: number
	acquisitionMs: number
	sessionCloseMs: number
	surfaceMs: number
	clientMs: number
}> = Object.freeze({
	drainMs: 30_000,
	acquisitionMs: 30_000,
	sessionCloseMs: 30_000,
	surfaceMs: 10_000,
	clientMs: 45_000
})
export type WorkerCloseIssue = Readonly<{
	stage:
		| 'account-store'
		| 'broker'
		| 'realm'
		| 'application'
		| 'acquisition'
		| 'session'
		| 'reader'
		| 'attachments'
	reason: 'overdue' | 'failed' | 'custody'
}>
