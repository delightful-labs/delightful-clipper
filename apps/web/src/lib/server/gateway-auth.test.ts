import { expect, it, vi } from 'vitest'
import { RequestAuthenticationError } from 'jazz-tools/backend'
import { authenticateGateway } from './gateway-auth.js'

it('delegates cookie and native guest proof admission to the actual backend authority', async () => {
	const request = new Request('https://example.invalid/api/capture/resolve', {
		headers: { cookie: 'better-auth.session_token=opaque' }
	})
	const accountFor = vi.fn(async () => '77777777-7777-4777-8777-777777777777')
	expect(await authenticateGateway(request, { accountFor })).toEqual({
		accountId: '77777777-7777-4777-8777-777777777777'
	})
	expect(accountFor).toHaveBeenCalledWith(request)
})
it('distinguishes missing/invalid identity from an unavailable authority', async () => {
	const request = new Request('https://example.invalid/api/capture/resolve')
	for (const accountFor of [
		async () => null,
		async () => {
			throw new RequestAuthenticationError('invalid proof')
		}
	]) {
		const response = await authenticateGateway(request, { accountFor })
		expect(response).toBeInstanceOf(Response)
		if (!(response instanceof Response)) throw Error('Expected refusal')
		expect(response.status).toBe(401)
	}
	const response = await authenticateGateway(request, {
		accountFor: async () => {
			throw Error('internal credentials must not escape')
		}
	})
	if (!(response instanceof Response)) throw Error('Expected unavailable')
	expect(response.status).toBe(503)
	expect(await response.json()).toEqual({ code: 'gatewayUnavailable', retryable: true })
})
