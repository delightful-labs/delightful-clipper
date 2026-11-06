import { createAuthDatabase } from './database.js'
import { createAuthServer } from './server.js'

// Each server process owns one auth instance and its connection pool.
let auth: ReturnType<typeof createAuthServer> | undefined

export function handleAuth(request: Request): Response | Promise<Response> {
	const origin = process.env.AUTH_BASE_URL
	const secret = process.env.AUTH_SECRET
	if (!origin || !secret || !process.env.AUTH_DATABASE_URL) {
		return new Response(null, { status: 503, headers: { 'Cache-Control': 'no-store' } })
	}
	auth ??= createAuthServer(createAuthDatabase(), { origin, secret })
	return auth.handler(request)
}
