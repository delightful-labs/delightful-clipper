import type { Handle } from '@sveltejs/kit/hooks'
import { authenticateGateway } from './lib/server/gateway-auth.js'
import { jazz } from './lib/server/jazz.js'

export const handle: Handle = async ({ event, resolve }) => {
	if (event.url.pathname === '/api/capture' || event.url.pathname.startsWith('/api/capture/')) {
		const identity = await authenticateGateway(event.request, jazz)
		if (identity instanceof Response) return identity
		event.locals.gatewayAccountId = identity.accountId
		const response = await resolve(event)
		response.headers.set('Cache-Control', 'private, no-store')
		return response
	}
	return resolve(event)
}
