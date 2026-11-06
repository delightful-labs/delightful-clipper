import { createAuthDatabase, postgresConnection } from './database.js'
import { createAuthServer, authConfiguration } from './server.js'

// Each server process owns one auth instance and its connection pool.
let auth: ReturnType<typeof createAuthServer> | undefined

function unavailable(error: string, fields: string[] = [], status = 503): Response {
	return Response.json({ error, fields }, { status, headers: { 'Cache-Control': 'no-store' } })
}

export async function handleAuth(request: Request): Promise<Response> {
	const parsed = authConfiguration.safeParse({
		origin: process.env.AUTH_BASE_URL,
		secret: process.env.AUTH_SECRET
	})
	const connection = postgresConnection.safeParse(process.env.AUTH_DATABASE_URL)
	const fields: string[] = []
	if (!parsed.success) {
		for (const issue of parsed.error.issues) {
			const field = issue.path[0] === 'origin' ? 'AUTH_BASE_URL' : 'AUTH_SECRET'
			if (!fields.includes(field)) fields.push(field)
		}
	}
	if (!connection.success) fields.push('AUTH_DATABASE_URL')
	if (!parsed.success || !connection.success)
		return unavailable('invalid_auth_configuration', fields)
	let stage = 'initialization'
	try {
		auth ??= createAuthServer(createAuthDatabase(connection.data), parsed.data)
		stage = 'request'
		return await auth.handler(request)
	} catch {
		// Deliberately exclude raw errors, connection strings, tokens and stack traces.
		return unavailable(`auth_${stage}_failed`, [], 500)
	}
}
