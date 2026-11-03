import { parentPort, workerData } from 'node:worker_threads'
import { extract } from './extract.js'
import { CaptureError } from './errors.js'
import type { ParserReply } from './parser-protocol.js'
async function run() {
	const input: unknown = workerData
	if (
		!input ||
		typeof input !== 'object' ||
		!('body' in input) ||
		!(input.body instanceof Uint8Array) ||
		input.body.byteLength > 10 * 1024 * 1024 ||
		!('mediaType' in input) ||
		typeof input.mediaType !== 'string' ||
		!('url' in input) ||
		typeof input.url !== 'string'
	)
		throw new CaptureError('invalidInput', 400)
	return extract(input.body, input.mediaType, input.url)
}
try {
	const value = await run()
	parentPort?.postMessage({ kind: 'success', value } satisfies ParserReply)
} catch (error) {
	const failure = error instanceof CaptureError ? error : new CaptureError('parseFailed', 422)
	parentPort?.postMessage({
		kind: 'failed',
		code: failure.code,
		status: failure.status,
		retryable: failure.retryable
	} satisfies ParserReply)
} finally {
	parentPort?.close()
}
