import { configuredAuth } from './auth/handler.js'
import { extensionOrigin } from '../../../../../tooling/extension-identity.js'
import {
	acceptLocalFirstAuth,
	createJazz,
	memory,
	remote,
	sqlite,
	vercel
} from 'jazz-tools/backend'
import { app } from '../backend/jazz/schema.js'
import permissions from '../backend/jazz/permissions.js'
import { jazzCoreName } from './jazz-core-name.js'

// Jazz owns lazy acquisition, schema publication, sockets, and core lifecycle.
// The local alpha.60 store has a separate path from the previous SDK's data.
const coreName = jazzCoreName(process.env)
const store = process.env.VERCEL
	? vercel({
			vcpus: 1,
			maxDriveBytes: 1024 ** 3,
			blobs: 'sqlite',
			idleMs: 60_000,
			...(coreName ? { name: coreName } : {})
		})
	: process.env.CLIPPER_TEST === 'true' && process.env.CLIPPER_TEST_CORE_URL
		? remote({
				url: process.env.CLIPPER_TEST_CORE_URL,
				appId: process.env.PUBLIC_JAZZ_APP_ID ?? '',
				secret: process.env.CLIPPER_TEST_CORE_SECRET ?? ''
			})
		: process.env.CLIPPER_EPHEMERAL_JAZZ === 'true' || process.env.VITEST
			? memory()
			: sqlite({ path: '.jazz/alpha60/clipper.sqlite' })

// Production admission must not trust caller-controlled forwarding headers.
const publicUrl = process.env.VERCEL
	? [
			process.env.VERCEL_URL,
			process.env.VERCEL_BRANCH_URL,
			process.env.VERCEL_PROJECT_PRODUCTION_URL,
			...(process.env.VERCEL_ENV === 'production'
				? ['clipper.delightfullabs.com', 'delightful-clipper.vercel.app']
				: [])
		]
			.filter((host): host is string => Boolean(host))
			.map((host) => `https://${host}/jazz`)
	: undefined
if (publicUrl?.length === 0) throw new Error('Missing Vercel deployment audience')
export const jazz = createJazz({
	app,
	permissions,
	store,
	authenticate: async (request) => {
		const auth = configuredAuth()
		const session = auth ? await auth.api.getSession({ headers: request.headers }) : null
		return session ? { userId: session.user.id } : acceptLocalFirstAuth(request)
	},
	allowedOrigins: [extensionOrigin],
	...(publicUrl ? { publicUrl } : {})
})
