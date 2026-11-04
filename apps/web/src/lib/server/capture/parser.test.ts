import { expect, it } from 'vitest'
import { extractInWorker } from './parser.js'
it('extracts in an isolated worker and returns only its settled result', async () => {
	const result = await extractInWorker(
		new TextEncoder().encode('Literal <script> is text.'),
		'text/plain',
		'https://example.com/',
		new AbortController().signal
	)
	expect(result.candidate.text).toBe('Literal <script> is text.')
	expect(result.candidate.html).not.toContain('<script>')
})
it('terminates and drains a canceled worker before returning', async () => {
	const controller = new AbortController()
	const pending = extractInWorker(
		new TextEncoder().encode('Cancel this parse'),
		'text/plain',
		'https://example.com/',
		controller.signal
	)
	controller.abort()
	await expect(pending).rejects.toMatchObject({ code: 'canceled', status: 408 })
	const result = await extractInWorker(
		new TextEncoder().encode('Next request'),
		'text/plain',
		'https://example.com/',
		new AbortController().signal
	)
	expect(result.candidate.text).toBe('Next request')
})
it('rejects oversized input before acquiring a worker', async () => {
	await expect(
		extractInWorker(
			new Uint8Array(10 * 1024 * 1024 + 1),
			'text/plain',
			'https://example.com/',
			new AbortController().signal
		)
	).rejects.toMatchObject({ code: 'sourceTooLarge', status: 413 })
})
it('validates worker input as bounded bytes and strings', async () => {
	const { parserInputSchema } = await import('./parser-protocol.js')
	const input = { body: new Uint8Array([1]), mediaType: 'text/plain', url: 'https://example.com/' }
	expect(parserInputSchema.safeParse(input).success).toBe(true)
	expect(parserInputSchema.safeParse({ ...input, body: [1] }).success).toBe(false)
	expect(
		parserInputSchema.safeParse({ ...input, body: new Uint8Array(10 * 1024 * 1024 + 1) }).success
	).toBe(false)
	expect(parserInputSchema.safeParse({ ...input, url: 12 }).success).toBe(false)
})
