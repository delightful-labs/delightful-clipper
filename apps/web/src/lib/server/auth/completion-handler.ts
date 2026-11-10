import {
	completionCookie,
	readCompletion,
	clearCompletionCookie,
	completedAttempt
} from './completion.js'

type Auth = {
	handler: (request: Request) => Promise<Response>
	api: { getSession: (input: { headers: Headers }) => Promise<{ user: { id: string } } | null> }
}
export async function handleConfiguredAuth(
	auth: Auth,
	request: Request,
	config: { origin: string; secret: string }
) {
	const url = new URL(request.url)
	if (url.pathname === '/api/auth/atproto/completion') {
		if (request.method !== 'POST' || request.headers.get('origin') !== config.origin)
			return failure('invalid_completion_request', 403)
		const receipt = readCompletion(request, config.secret)
		const session = await auth.api.getSession({ headers: request.headers })
		if (!receipt || receipt.userId !== session?.user.id)
			return failure('oauth_completion_unavailable', 409)
		return Response.json(
			{ attemptId: receipt.attemptId, userId: receipt.userId },
			{
				headers: { 'Cache-Control': 'no-store', 'Set-Cookie': clearCompletionCookie }
			}
		)
	}
	const response = await auth.handler(request)
	if (url.pathname !== '/api/auth/atproto/callback') return response
	const attemptId = completedAttempt(response, config.origin)
	if (!attemptId) return response
	// Resolve the newly issued session, never the incoming (possibly older) cookie.
	const cookies = response.headers
		.getSetCookie()
		.map((cookie) => cookie.split(';')[0])
		.join('; ')
	const session = await auth.api.getSession({ headers: new Headers({ cookie: cookies }) })
	if (!session) return failure('oauth_completion_unavailable', 409)
	const headers = new Headers(response.headers)
	headers.append(
		'Set-Cookie',
		completionCookie(attemptId, session.user.id, config.secret, url.protocol === 'https:')
	)
	return new Response(response.body, { status: response.status, headers })
}
function failure(error: string, status: number) {
	return Response.json({ error }, { status, headers: { 'Cache-Control': 'no-store' } })
}
