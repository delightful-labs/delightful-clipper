import { betterAuth } from 'better-auth'
import { atproto } from '@kingironman2011/better-auth-bsky'
import { jazzAdapter } from 'jazz-tools/better-auth-adapter'
import type { Db, BackendSchemaInput } from 'jazz-tools/backend'
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

export function createAuthServer(
	storage: { db: () => Db | Promise<Db>; schema: BackendSchemaInput },
	input: { origin: string; secret: string }
) {
	const parsed = authConfiguration.safeParse(input)
	if (!parsed.success) throw new Error('Invalid auth server configuration')
	const { origin, secret } = parsed.data
	return betterAuth({
		database: jazzAdapter(storage),
		baseURL: origin,
		basePath: '/api/auth',
		secret,
		plugins: [atproto({ clientName: 'Delightful Clipper' })]
	})
}
