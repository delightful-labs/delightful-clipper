import { CaptureError } from './errors.js'
import { sourceUrl } from './destination.js'
export async function readCaptureInput(request: Request, signal: AbortSignal) {
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
