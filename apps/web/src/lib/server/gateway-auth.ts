import { isRequestAuthenticationError, resolveRequestSession } from 'jazz-tools/backend'
import type { BackendRequestAuthConfig } from 'jazz-tools/backend'
import { authConfiguration } from './auth/server.js'

/** Explicit trust for the same app-issued tokens accepted by Jazz Cloud. */
export function externalJWTVerification(origin: unknown) {
	const parsed = authConfiguration.shape.origin.safeParse(origin)
	if (!parsed.success) return {}
	return {
		jwksUrl: parsed.data + '/api/auth/jwks',
		jwtIssuer: parsed.data,
		jwtAudience: parsed.data
	}
}

/** Registry admission binds the signed bearer to its canonical Jazz account. */
export async function authenticateGateway(
	request: Request,
	config: Pick<BackendRequestAuthConfig, 'appId' | 'jwksUrl' | 'jwtIssuer' | 'jwtAudience'> & {
		accountRegistry: string
	}
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
