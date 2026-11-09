import { app } from '../../backend/jazz/schema.js'
import { handleConfiguredAuth } from './completion-handler.js'
import { createAuthServer, authConfiguration } from './server.js'

// The adapter acquires the existing Jazz backend lazily, avoiding startup cycles.
let auth: ReturnType<typeof createAuthServer> | undefined

function unavailable(error: string, fields: string[] = [], status = 503): Response {
	return Response.json({ error, fields }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export function configuredAuth() {
	const parsed = authConfiguration.safeParse({
		origin: process.env.AUTH_BASE_URL,
		secret: process.env.AUTH_SECRET
	})
	if (!parsed.success) return undefined
	return (auth ??= createAuthServer(
		{ db: async () => (await import('../jazz.js')).jazz.db, schema: app },
		parsed.data
	))
}

export async function handleAuth(request: Request): Promise<Response> {
	const parsed = authConfiguration.safeParse({
		origin: process.env.AUTH_BASE_URL,
		secret: process.env.AUTH_SECRET
	})
	const fields: string[] = []
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			const field = issue.path[0] === 'origin' ? 'AUTH_BASE_URL' : 'AUTH_SECRET'
			if (!fields.includes(field)) fields.push(field)
		}
	}
	if (!parsed.success) return unavailable('invalid_auth_configuration', fields)
	let stage = 'initialization'
	try {
		const configured = configuredAuth()
		if (!configured) return unavailable('invalid_auth_configuration')
		stage = 'request'
		return await handleConfiguredAuth(configured, request, parsed.data)
	} catch {
		// Deliberately exclude raw errors, connection strings, tokens and stack traces.
		return unavailable(`auth_${stage}_failed`, [], 500)
	}
}
