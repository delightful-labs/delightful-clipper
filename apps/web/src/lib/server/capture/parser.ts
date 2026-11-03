import { Worker } from 'node:worker_threads'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createActor, toPromise } from 'xstate'
import { parserWorkerMachine } from '../../machines/capture/parser-worker.js'
import type { WorkerOpen } from '../../machines/capture/parser-worker.js'
import { CaptureError } from './errors.js'
import type { ExtractedContent, ParserReply } from './parser-protocol.js'
/** Node I/O bridge only: the machine decides termination, deadlines and outcome precedence. */
function workerOpen(body: Uint8Array, mediaType: string, url: string): WorkerOpen {
	return (report) => {
		const relativePath = import.meta.env.DEV
			? '../../../../.netlify/v1/parser/extract-worker.mjs'
			: '../parser/extract-worker.mjs'
		const workerUrl =
			import.meta.env.DEV || process.env.LAMBDA_TASK_ROOT
				? new URL(relativePath, import.meta.url)
				: pathToFileURL(resolve('.netlify/v1/parser/extract-worker.mjs'))
		const payload = new Uint8Array(body)
		const worker = new Worker(workerUrl, {
			execArgv: ['--experimental-require-module'],
			resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
			workerData: { body: payload, mediaType, url },
			transferList: [payload.buffer]
		})
		const message = (reply: ParserReply) => report({ type: 'WORKER_RESULT', reply })
		const error = (value: Error & { code?: string }) =>
			report({ type: 'WORKER_ERROR', code: value.code ?? 'UNKNOWN' })
		const exit = () => report({ type: 'WORKER_EXIT' })
		worker.on('message', message)
		worker.on('error', error)
		worker.on('exit', exit)
		return {
			terminate: () => {
				void worker
					.terminate()
					.catch(() => report({ type: 'WORKER_ERROR', code: 'TERMINATION_FAILED' }))
			},
			release: () => {
				worker.off('message', message)
				worker.off('error', error)
				worker.off('exit', exit)
				// Normal settlement follows exit; forced parent stop still requests resource cleanup.
				if (worker.threadId !== -1) void worker.terminate().catch(() => {})
			}
		}
	}
}
/** One machine per extraction; the gateway request owns this attachment through settlement. */
export async function extractInWorker(
	body: Uint8Array,
	mediaType: string,
	url: string,
	signal: AbortSignal
): Promise<ExtractedContent> {
	signal.throwIfAborted()
	if (body.byteLength > 10 * 1024 * 1024) throw new CaptureError('sourceTooLarge', 413)
	const actor = createActor(parserWorkerMachine, {
		input: { open: workerOpen(body, mediaType, url) }
	})
	const abort = () => actor.send({ type: 'CANCEL' })
	signal.addEventListener('abort', abort, { once: true })
	try {
		actor.start()
		if (signal.aborted) abort()
		const result = await toPromise(actor)
		if (signal.aborted) throw new CaptureError('canceled', 408, true)
		if (result.kind === 'failed')
			throw new CaptureError(result.code, result.status, result.retryable)
		return result.value
	} finally {
		signal.removeEventListener('abort', abort)
		actor.stop()
	}
}
