import { parserInputSchema } from './parser-protocol.js'
import { parentPort, workerData } from 'node:worker_threads'
import { extract } from './extract.js'
import { CaptureError } from './errors.js'
import type { ParserReply } from './parser-protocol.js'
async function run() {
	const input: unknown = workerData
	const parsed = parserInputSchema.safeParse(input)
	if (!parsed.success) throw new CaptureError('invalidInput', 400)
	return extract(parsed.data.body, parsed.data.mediaType, parsed.data.url)
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
