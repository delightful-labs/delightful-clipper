import { betterAuth } from 'better-auth'
import { jwt } from 'better-auth/plugins'
import { atproto } from '@kingironman2011/better-auth-bsky'
import type { Pool } from 'pg'
import { z } from 'zod'

export const authConfiguration = z.object({
	origin: z
		.url()
		.refine((value) => {
			if (!URL.canParse(value)) return false
			const url = new URL(value)
			return (
				url.pathname === '/' &&
				!url.search &&
				!url.hash &&
				!url.username &&
				!url.password &&
				(url.protocol === 'https:' ||
					(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname)))
			)
		})
		.transform((value) => new URL(value).origin),
	secret: z.string().min(32)
})

export function createAuthServer(database: Pool, input: { origin: string; secret: string }) {
	const parsed = authConfiguration.safeParse(input)
	if (!parsed.success) throw new Error('Invalid auth server configuration')
	const { origin, secret } = parsed.data
	return betterAuth({
		database,
		baseURL: origin,
		basePath: '/api/auth',
		secret,
		plugins: [
			atproto({ clientName: 'Delightful Clipper' }),
			jwt({ jwt: { issuer: origin, audience: origin, definePayload: () => ({}) } })
		]
	})
}
