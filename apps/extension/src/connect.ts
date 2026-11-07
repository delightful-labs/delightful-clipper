import { acceptedAcknowledgmentSchema } from './protocol.js'
export async function confirmConnection(accountId: string, requestId?: string) {
	if (
		!acceptedAcknowledgmentSchema.safeParse(
			await chrome.runtime.sendMessage({
				type: 'CONNECT',
				accountId,
				...(requestId ? { requestId } : {})
			})
		).success
	)
		throw new Error('connectionUnavailable')
}
