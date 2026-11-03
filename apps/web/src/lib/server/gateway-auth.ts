import { isRequestAuthenticationError, resolveRequestSession } from 'jazz-tools/backend'

/** Registry admission binds the signed bearer to its canonical Jazz account. */
export async function authenticateGateway(
	request: Request,
	config: { appId: string; accountRegistry: string }
) {
	const headers = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json' }
	const failure = (status: 401 | 503) =>
		new Response(
			JSON.stringify({
				code: status === 401 ? 'sessionUnavailable' : 'gatewayUnavailable',
				retryable: status === 503
			}),
			{ status, headers }
		)
	if (!config.appId || !config.accountRegistry) return failure(503)
	try {
		const session = await resolveRequestSession(
			request,
			{ ...config, allowLocalFirstAuth: true },
			{ account: 'login' }
		)
		if (!session.account_id) return failure(503)
		return { accountId: session.account_id }
	} catch (error) {
		return failure(isRequestAuthenticationError(error) ? 401 : 503)
	}
}
