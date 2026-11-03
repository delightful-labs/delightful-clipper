import { createActor, toPromise } from 'xstate'
import { createGatewayMachine } from '../../machines/capture/gateway.js'
import { CaptureError } from './errors.js'
import { sourceUrl, resolveDestination } from './destination.js'
import { fetchHop } from './transport.js'
import { extract } from './extract.js'
const machine = createGatewayMachine({ resolve: resolveDestination, fetch: fetchHop, extract })
// Instance-local abuse bound, not a distributed quota or persistent account store.
const owners = new Map<string, { start: number; count: number; active: number }>()
function acquire(owner: string) {
	const now = Date.now()
	for (const [id, value] of owners)
		if (value.active === 0 && now - value.start >= 60000) owners.delete(id)
	let value = owners.get(owner)
	if (!value) {
		if (owners.size >= 1024) throw new CaptureError('rateLimited', 429, true)
		value = { start: now, count: 0, active: 0 }
		owners.set(owner, value)
	}
	if (now - value.start >= 60000) {
		value.start = now
		value.count = 0
	}
	if (value.active >= 2 || value.count >= 20) throw new CaptureError('rateLimited', 429, true)
	value.active++
	value.count++
	return () => {
		value.active--
	}
}
async function readInput(request: Request, signal: AbortSignal) {
	if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
		throw new CaptureError('invalidInput', 400)
	const reader = request.body?.getReader()
	if (!reader) throw new CaptureError('invalidInput', 400)
	const abort = () => {
		void reader.cancel().catch(() => {})
	}
	signal.addEventListener('abort', abort, { once: true })
	const chunks: Uint8Array[] = []
	let length = 0
	try {
		signal.throwIfAborted()
		for (;;) {
			const next = await reader.read()
			if (next.done) break
			length += next.value.byteLength
			if (length > 16384) throw new CaptureError('invalidInput', 413)
			chunks.push(next.value)
		}
	} finally {
		signal.removeEventListener('abort', abort)
		await reader.cancel().catch(() => {})
		reader.releaseLock()
	}
	signal.throwIfAborted()
	const body = new Uint8Array(length)
	let offset = 0
	for (const chunk of chunks) {
		body.set(chunk, offset)
		offset += chunk.length
	}
	let input: unknown
	try {
		input = JSON.parse(new TextDecoder().decode(body))
	} catch {
		throw new CaptureError('invalidInput', 400)
	}
	if (
		!input ||
		typeof input !== 'object' ||
		!('protocolVersion' in input) ||
		input.protocolVersion !== 1 ||
		!('operationId' in input) ||
		typeof input.operationId !== 'string' ||
		!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.operationId) ||
		!('url' in input) ||
		typeof input.url !== 'string' ||
		Object.keys(input).some((key) => !['protocolVersion', 'operationId', 'url'].includes(key))
	)
		throw new CaptureError('invalidInput', 400)
	return { operationId: input.operationId, url: sourceUrl(input.url).href }
}
const headers = {
	'Cache-Control': 'private, no-store',
	'Content-Type': 'application/json',
	'X-Content-Type-Options': 'nosniff'
}
export async function capture(
	request: Request,
	accountId: string | undefined,
	mode: 'resolve' | 'extract',
	enabled = false
) {
	let release: (() => void) | undefined
	const expiresAt = performance.now() + 20000
	const deadline = AbortSignal.timeout(20000)
	const signal = AbortSignal.any([request.signal, deadline])
	try {
		if (!accountId) throw new CaptureError('sessionUnavailable', 401)
		if (!enabled) throw new CaptureError('gatewayUnavailable', 503, true)
		const origin = request.headers.get('origin')
		if (origin && origin !== new URL(request.url).origin)
			throw new CaptureError('permissionDenied', 403)
		release = acquire(accountId)
		const input = await readInput(request, signal)
		signal.throwIfAborted()
		const result = await toPromise(
			createActor(machine, { input: { ...input, mode, signal } }).start()
		)
		signal.throwIfAborted()
		if (performance.now() >= expiresAt) throw new CaptureError('fetchTimeout', 504, true)
		if (result.kind === 'failed') throw result.error
		const payload = JSON.stringify(
			mode === 'resolve'
				? {
						operationId: input.operationId,
						submittedUrl: input.url,
						finalUrl: result.finalUrl,
						redirects: result.provenance.redirects,
						resolvedAt: result.provenance.resolvedAt
					}
				: {
						operationId: input.operationId,
						finalUrl: result.finalUrl,
						provenance: result.provenance,
						...result.extraction
					}
		)
		if (new TextEncoder().encode(payload).length > 5 * 1024 * 1024)
			throw new CaptureError('sourceTooLarge', 413)
		return new Response(payload, { headers })
	} catch (error) {
		const failure =
			error instanceof CaptureError
				? error
				: signal.aborted
					? new CaptureError(
							deadline.aborted ? 'fetchTimeout' : 'canceled',
							deadline.aborted ? 504 : 408,
							true
						)
					: new CaptureError('sourceUnavailable', 502, true)
		return new Response(JSON.stringify({ code: failure.code, retryable: failure.retryable }), {
			status: failure.status,
			headers: { ...headers, ...(failure.status === 429 ? { 'Retry-After': '60' } : {}) }
		})
	} finally {
		release?.()
	}
}
