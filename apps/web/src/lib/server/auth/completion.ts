import { createHmac, timingSafeEqual } from 'node:crypto'
import { z } from 'zod'

const cookieName = 'clipper.oauth-completion'
const lifetime = 10 * 60 * 1000
const receiptSchema = z.object({
	attemptId: z.uuid(),
	userId: z.string().min(1),
	expires: z.number()
})
export const callbackPath = (attemptId: string) => `/?atproto_attempt=${z.uuid().parse(attemptId)}`
function signature(value: string, secret: string) {
	return createHmac('sha256', secret).update(value).digest('base64url')
}
export function completionCookie(
	attemptId: string,
	userId: string,
	secret: string,
	secure: boolean
) {
	const value = Buffer.from(
		JSON.stringify({ attemptId, userId, expires: Date.now() + lifetime })
	).toString('base64url')
	return `${cookieName}=${value}.${signature(value, secret)}; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=600${secure ? '; Secure' : ''}`
}
export function readCompletion(request: Request, secret: string) {
	try {
		const cookie = request.headers
			.get('cookie')
			?.split(';')
			.map((part) => part.trim())
			.find((part) => part.startsWith(cookieName + '='))
			?.slice(cookieName.length + 1)
		const [value, mac] = cookie?.split('.') ?? []
		if (!value || !mac) return undefined
		const expected = Buffer.from(signature(value, secret))
		const received = Buffer.from(mac)
		if (expected.length !== received.length || !timingSafeEqual(expected, received))
			return undefined
		const receipt = receiptSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString()))
		return receipt.expires > Date.now() ? receipt : undefined
	} catch {
		return undefined
	}
}
export const clearCompletionCookie = `${cookieName}=; HttpOnly; SameSite=Lax; Path=/api/auth; Max-Age=0`

// Only a successful provider callback can supply this redirect. Arbitrary redirects,
// authorization errors and an existing session cannot mint a completion receipt.
export function completedAttempt(response: Response, origin: string) {
	if (response.status !== 302) return undefined
	const location = response.headers.get('location')
	if (!location) return undefined
	const url = new URL(location, origin)
	const attemptId = z.uuid().safeParse(url.searchParams.get('atproto_attempt'))
	return url.origin === origin && url.pathname === '/' && attemptId.success
		? attemptId.data
		: undefined
}
