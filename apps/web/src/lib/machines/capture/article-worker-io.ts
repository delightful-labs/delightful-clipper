import type { WorkerCall, RpcReply } from '../../contracts/article-worker.js'
export async function readCaptureResponse(
	request: (mode: 'resolve' | 'extract', body: unknown, signal: AbortSignal) => Promise<Response>,
	call: Extract<WorkerCall, { method: 'resolve' | 'extract' }>,
	signal: AbortSignal,
	isCurrent: () => boolean
): Promise<RpcReply> {
	signal.throwIfAborted()
	const response = await request(
		call.method,
		{ protocolVersion: 1, operationId: call.requestId, url: call.url },
		signal
	)
	const bytes = await readResponseBytes(response, signal, isCurrent)
	return { method: call.method, bytes, status: response.status }
}
export async function readResponseBytes(
	response: Response,
	signal: AbortSignal,
	isCurrent: () => boolean,
	limit = 5 * 1024 * 1024
) {
	const reader = response.body?.getReader()
	if (!reader) throw new Error('invalidResponse')
	const chunks: Uint8Array[] = []
	let size = 0
	const abort = () => {
		void reader.cancel().catch(() => {})
	}
	signal.addEventListener('abort', abort, { once: true })
	try {
		if (signal.aborted) {
			await reader.cancel()
			signal.throwIfAborted()
		}
		if (!isCurrent()) throw new Error('scopeChanged')
		for (;;) {
			const next = await reader.read()
			if (next.done) break
			size += next.value.byteLength
			if (size > limit) throw new Error('sourceTooLarge')
			chunks.push(next.value)
		}
		signal.throwIfAborted()
		if (!isCurrent()) throw new Error('scopeChanged')
		const bytes = new Uint8Array(size)
		let offset = 0
		for (const chunk of chunks) {
			bytes.set(chunk, offset)
			offset += chunk.length
		}
		return bytes
	} finally {
		signal.removeEventListener('abort', abort)
		await reader.cancel().catch(() => {})
		reader.releaseLock()
	}
}
