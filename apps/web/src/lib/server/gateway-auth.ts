import { isRequestAuthenticationError, isNoJazzAccountError, type Jazz } from 'jazz-tools/backend'

/** Backend admission binds the request proof to its canonical Jazz account. */
export async function authenticateGateway(request: Request, backend: Pick<Jazz, 'accountFor'>) {
	const headers = { 'Cache-Control': 'private, no-store', 'Content-Type': 'application/json' }
	const failure = (status: 401 | 503) =>
		new Response(
			JSON.stringify({
				code: status === 401 ? 'sessionUnavailable' : 'gatewayUnavailable',
				retryable: status === 503
			}),
			{ status, headers }
		)
	try {
		const accountId = await backend.accountFor(request)
		if (!accountId) return failure(401)
		return { accountId }
	} catch (error) {
		return failure(isRequestAuthenticationError(error) || isNoJazzAccountError(error) ? 401 : 503)
	}
}
