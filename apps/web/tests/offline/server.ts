import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
export function staticShellServer(initialRoot: string) {
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
