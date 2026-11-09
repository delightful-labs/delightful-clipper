import type { Jazz } from 'jazz-tools/backend'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
export function staticShellServer(initialRoot: string) {
	let backend: Jazz | undefined
	let auth: ((request: Request) => Promise<Response>) | undefined
	let root = resolve(initialRoot),
		failRoot = false,
		failWorker = false
	const requests: { path: string; bytes: number }[] = []
	const mime: Record<string, string> = {
		'.html': 'text/html',
		'.js': 'text/javascript',
		'.css': 'text/css',
		'.wasm': 'application/wasm',
		'.json': 'application/json',
		'.svg': 'image/svg+xml',
		'.woff2': 'font/woff2'
	}
	const server = createServer(async (req, res) => {
		const url = new URL(req.url ?? '/', 'http://127.0.0.1:5190')
		if (auth && url.pathname.startsWith('/api/auth/')) {
			const chunks: Buffer[] = []
			for await (const chunk of req) chunks.push(Buffer.from(chunk))
			const headers = new Headers()
			for (const [key, value] of Object.entries(req.headers)) {
				if (Array.isArray(value)) for (const item of value) headers.append(key, item)
				else if (value !== undefined) headers.append(key, value)
			}
			const method = req.method ?? 'GET'
			const request = new Request(url, {
				method,
				headers,
				...(method === 'GET' || method === 'HEAD' ? {} : { body: Buffer.concat(chunks) })
			})
			const response = await auth(request)
			res.writeHead(response.status, {
				...Object.fromEntries(response.headers.entries()),
				'set-cookie': response.headers.getSetCookie()
			})
			res.end(Buffer.from(await response.arrayBuffer()))
			return
		}
		if (backend && (url.pathname === '/jazz' || url.pathname.startsWith('/jazz/'))) {
			backend.nodeHandler(req, res)
			return
		}
		if (url.pathname === '/api/private-probe') {
			res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'private, no-store' })
			res.end('Private response must not be cached')
			return
		}
		if (
			(url.pathname === '/' && failRoot) ||
			(url.pathname.includes('/immutable/workers/') &&
				failWorker &&
				!['worker', 'sharedworker'].includes(String(req.headers['sec-fetch-dest'])))
		) {
			res.writeHead(503)
			res.end('Fixture failure')
			return
		}
		const path = resolve(
			root,
			'.' + decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
		)
		if (!path.startsWith(root + sep)) {
			res.writeHead(404)
			res.end()
			return
		}
		try {
			if (!(await stat(path)).isFile()) throw new Error('Not a file')
			const bytes = await readFile(path)
			requests.push({ path: url.pathname, bytes: bytes.length })
			res.writeHead(200, {
				'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
				'Cache-Control': 'no-cache'
			})
			res.end(bytes)
		} catch {
			res.writeHead(404)
			res.end()
		}
	})
	return {
		requests,
		useAuth: (handler: (request: Request) => Promise<Response>) => {
			auth = handler
		},
		useJazz: async (next: Jazz) => {
			backend = next
			await next.attach(server)
		},
		failWorker: (value: boolean) => {
			failWorker = value
		},
		setRoot: (next: string) => {
			root = resolve(next)
		},
		failRoot: (value: boolean) => {
			failRoot = value
		},
		start: () =>
			new Promise<void>((resolve, reject) => {
				if (server.listening) {
					resolve()
					return
				}
				server.once('error', reject)
				server.listen(5190, '127.0.0.1', () => {
					server.removeListener('error', reject)
					resolve()
				})
			}),
		stop: () =>
			new Promise<void>((resolve, reject) => {
				if (!server.listening) {
					resolve()
					return
				}
				server.closeAllConnections()
				server.close((error) => (error ? reject(error) : resolve()))
			})
	}
}
