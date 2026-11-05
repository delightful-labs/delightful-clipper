import { z } from 'zod'
const acknowledged = z.object({ accepted: z.literal(true) })
export async function confirmConnection(accountId: string, requestId?: string) {
	if (
		!acknowledged.safeParse(
			await chrome.runtime.sendMessage({
				type: 'CONNECT',
				accountId,
				...(requestId ? { requestId } : {})
			})
		).success
	)
		throw new Error('connectionUnavailable')
}
