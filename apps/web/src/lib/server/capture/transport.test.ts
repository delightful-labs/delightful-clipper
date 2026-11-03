import { afterAll, beforeAll, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { fetchHop } from './transport.js'
let port = 0
let observedHost: string | undefined
const server = createServer((request, response) => {
	observedHost = request.headers.host
	if (request.url === '/redirect') {
		response.writeHead(302, { location: 'http://127.0.0.1/' })
		response.end()
		return
	}
	if (request.url === '/bomb') {
		response.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/html' })
		response.end(gzipSync('a'.repeat(2 * 1024 * 1024)))
		return
	}
	if (request.url === '/gzip') {
		response.writeHead(200, { 'content-encoding': 'gzip', 'content-type': 'text/html' })
		response.end(gzipSync('<p>Article text</p>'))
		return
	}
	if (request.url === '/slow') {
		request.on('close', () => response.destroy())
		return
	}
	response.writeHead(200, { 'content-type': 'text/html' })
	response.end('<p>Article text</p>')
})
beforeAll(async () => {
	await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
	const address = server.address()
	if (!address || typeof address === 'string') throw new Error('Missing server address')
	port = address.port
})
afterAll(async () => {
	server.closeAllConnections()
	await new Promise<void>((resolve, reject) =>
		server.close((error) => (error ? reject(error) : resolve()))
	)
})
// Direct leaf fixtures use a loopback pin; production only supplies resolver-validated public pins.
const destination = { address: '127.0.0.1', family: 4 }
it('connects only to the pinned address while keeping the original Host', async () => {
	const result = await fetchHop(
		new URL(`http://unresolvable.example:${port}/`),
		destination,
		new AbortController().signal
	)
	expect(observedHost).toBe(`unresolvable.example:${port}`)
	expect(new TextDecoder().decode(result.body)).toBe('<p>Article text</p>')
})
it('returns redirect evidence without automatically following it', async () => {
	const result = await fetchHop(
		new URL(`http://unresolvable.example:${port}/redirect`),
		destination,
		new AbortController().signal
	)
	expect(result.status).toBe(302)
	expect(result.location).toBe('http://127.0.0.1/')
	expect(result.body.length).toBe(0)
})
it('decompresses bounded gzip and rejects excessive expansion', async () => {
	const result = await fetchHop(
		new URL(`http://unresolvable.example:${port}/gzip`),
		destination,
		new AbortController().signal
	)
	expect(new TextDecoder().decode(result.body)).toBe('<p>Article text</p>')
	await expect(
		fetchHop(
			new URL(`http://unresolvable.example:${port}/bomb`),
			destination,
			new AbortController().signal
		)
	).rejects.toThrow('sourceTooLarge')
})
it('aborts a stalled response at the request deadline', async () => {
	await expect(
		fetchHop(
			new URL(`http://unresolvable.example:${port}/slow`),
			destination,
			AbortSignal.timeout(50)
		)
	).rejects.toThrow()
})
