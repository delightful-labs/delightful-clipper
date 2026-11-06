import { afterAll, beforeAll, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { gzipSync } from 'node:zlib'
import { fetchHop } from './transport.js'
import { extractInWorker } from './parser.js'
let port = 0
let observedHost: string | undefined
const server = createServer((request, response) => {
	observedHost = request.headers.host
	if (request.url === '/negotiated') {
		// Equal HTML/plain-text preference can select a publisher's Markdown response.
		const accepted = (request.headers.accept ?? '').split(',').map((entry) => {
			const [mediaType, ...parameters] = entry.trim().split(';')
			const quality = parameters.find((parameter) => parameter.trim().startsWith('q='))
			return { mediaType, quality: quality ? Number(quality.trim().slice(2)) : 1 }
		})
		const preference = (mediaType: string) =>
			accepted.find((entry) => entry.mediaType === mediaType)?.quality ?? 0
		const html = preference('text/html') > preference('text/plain')
		response.writeHead(200, { 'content-type': html ? 'text/html; charset=utf-8' : 'text/markdown' })
		response.end(
			html
				? '<html><head><title>Negotiated article</title></head><body><article><h1>Negotiated article</h1><p>Readable content selected by the requested representation.</p></article></body></html>'
				: '# Negotiated article\nReadable Markdown content.'
		)
		return
	}
	if (request.url === '/plain') {
		response.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' })
		response.end('Plain source content remains readable when HTML is unavailable.')
		return
	}
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
it('prefers a publisher’s HTML representation over plain-text negotiation and parses it through the real worker', async () => {
	const url = new URL(`http://unresolvable.example:${port}/negotiated`)
	const signal = new AbortController().signal
	const result = await fetchHop(url, destination, signal)
	expect(result.mediaType).toBe('text/html; charset=utf-8')
	const parsed = await extractInWorker(result.body, result.mediaType, url.href, signal)
	expect(parsed.candidate.title).toBe('Negotiated article')
	expect(parsed.candidate.text).toContain(
		'Readable content selected by the requested representation.'
	)
})
it('retains readable plain-text sources when a publisher does not offer HTML', async () => {
	const url = new URL(`http://unresolvable.example:${port}/plain`)
	const signal = new AbortController().signal
	const result = await fetchHop(url, destination, signal)
	const parsed = await extractInWorker(result.body, result.mediaType, url.href, signal)
	expect(parsed.candidate.text).toBe(
		'Plain source content remains readable when HTML is unavailable.'
	)
})
