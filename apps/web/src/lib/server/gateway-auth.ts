import { isRequestAuthenticationError, resolveRequestSession } from 'jazz-tools/backend'

/** Registry admission binds the signed bearer to its canonical Jazz account. */
export async function authenticateGateway(
	request: Request,
	config: { appId: string; accountRegistry: string }
) {
	const headers = { 'Cache-Control': 'private, no-store' }
	if (!config.appId || !config.accountRegistry) return new Response(null, { status: 503, headers })
	try {
		const session = await resolveRequestSession(
			request,
			{ ...config, allowLocalFirstAuth: true },
			{ account: 'login' }
		)
		if (!session.account_id) return new Response(null, { status: 503, headers })
		return { accountId: session.account_id }
	} catch (error) {
		return new Response(null, { status: isRequestAuthenticationError(error) ? 401 : 503, headers })
	}
}
