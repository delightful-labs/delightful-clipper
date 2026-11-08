import { createServer } from 'node:http'
import { join } from 'node:path'
import { acceptLocalFirstAuth, createJazz, memory, sqlite } from 'jazz-tools/backend'
import { app } from '../src/lib/backend/jazz/schema.js'
import permissions from '../src/lib/backend/jazz/permissions.js'

/** Disposable browser-test authority, using the same SDK backend path as the app. */
export async function startJazzAuthority(input: {
	port: number
	origin: string
	dataDir?: string
}) {
	const backend = createJazz({
		app,
		permissions,
		store: input.dataDir ? sqlite({ path: join(input.dataDir, 'core') }) : memory(),
		authenticate: acceptLocalFirstAuth,
		publicUrl: `http://127.0.0.1:${input.port}/jazz`,
		allowedOrigins: [input.origin]
	})
	const server = createServer((request, response) => backend.nodeHandler(request, response))
	const stop = async () => {
		await backend.close()
		server.closeAllConnections()
		await new Promise<void>((resolve) => server.close(() => resolve()))
	}
	try {
		await backend.attach(server)
		await backend.ready()
		await new Promise<void>((resolve, reject) => {
			server.once('error', reject)
			server.listen(input.port, '127.0.0.1', resolve)
		})
		return { stop }
	} catch (error) {
		await stop()
		throw error
	}
}
