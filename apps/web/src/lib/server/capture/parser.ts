import { Worker } from 'node:worker_threads'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { CaptureError } from './errors.js'
import type { ExtractedContent, ParserReply } from './parser-protocol.js'
/** Own the worker through exit, including message delivery, cancellation and termination. */
export function extractInWorker(
	body: Uint8Array,
	mediaType: string,
	url: string,
	signal: AbortSignal
): Promise<ExtractedContent> {
	signal.throwIfAborted()
	if (body.byteLength > 10 * 1024 * 1024)
		return Promise.reject(new CaptureError('sourceTooLarge', 413))
	const relativePath = import.meta.env.DEV
		? '../../../../.netlify/v1/parser/extract-worker.mjs'
		: '../parser/extract-worker.mjs'
	const workerUrl =
		import.meta.env.DEV || process.env.LAMBDA_TASK_ROOT
			? new URL(relativePath, import.meta.url)
			: pathToFileURL(resolve('.netlify/v1/parser/extract-worker.mjs'))
	const payload = new Uint8Array(body)
	return new Promise((resolve, reject) => {
		const worker = new Worker(workerUrl, {
			execArgv: ['--experimental-require-module'],
			resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
			workerData: { body: payload, mediaType, url },
			transferList: [payload.buffer]
		})
		let result: ParserReply | undefined
		let failure: CaptureError | undefined
		const terminate = () => {
			void worker.terminate().catch(() => {})
		}
		const abort = () => {
			failure = new CaptureError('canceled', 408, true)
			terminate()
		}
		const timer = setTimeout(() => {
			failure = new CaptureError('parseTimeout', 504, true)
			terminate()
		}, 10000)
		timer.unref()
		signal.addEventListener('abort', abort, { once: true })
		worker.once('message', (message: ParserReply) => {
			result = message
			terminate()
		})
		worker.once('error', (error) => {
			failure = new CaptureError(
				error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'sourceTooLarge' : 'gatewayUnavailable',
				error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 413 : 503,
				error.code !== 'ERR_WORKER_OUT_OF_MEMORY'
			)
		})
		worker.once('exit', () => {
			clearTimeout(timer)
			signal.removeEventListener('abort', abort)
			if (signal.aborted) {
				reject(new CaptureError('canceled', 408, true))
				return
			}
			if (failure) {
				reject(failure)
				return
			}
			if (result?.kind === 'success') {
				resolve(result.value)
				return
			}
			if (result?.kind === 'failed') {
				reject(new CaptureError(result.code, result.status, result.retryable))
				return
			}
			reject(new CaptureError('gatewayUnavailable', 503, true))
		})
		if (signal.aborted) abort()
	})
}
