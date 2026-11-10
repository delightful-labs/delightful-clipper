import { vi } from 'vitest'
import type { BrowserJobWorker, BrowserWorkerJobInput } from './browser-worker-job.js'

export class TestJobWorker implements BrowserJobWorker {
	onmessage: ((event: MessageEvent<unknown>) => void) | null = null
	onerror: ((event?: Event) => void) | null = null
	onmessageerror: ((event?: Event) => void) | null = null
	postMessage = vi.fn(
		(_message: unknown, _transfer?: Transferable[] | StructuredSerializeOptions) => {}
	)
	terminate = vi.fn(() => {})
	reply(value: unknown) {
		this.onmessage?.(new MessageEvent('message', { data: value }))
	}
}

/** A controlled native resource for parent tests; production uses real Workers. */
export function promiseWorkerJob<Request, Reply>(
	message: Request,
	decode: (value: unknown) => Reply,
	work: (signal: AbortSignal) => Promise<unknown>,
	now?: () => number
): BrowserWorkerJobInput<Request, Reply> {
	return {
		message,
		decode,
		...(now ? { now } : {}),
		open: () => {
			const worker = new TestJobWorker(),
				controller = new AbortController()
			worker.postMessage.mockImplementation(() => {
				void Promise.resolve()
					.then(() => work(controller.signal))
					.then(
						(value) => worker.reply(value),
						() => worker.onerror?.(new Event('error'))
					)
			})
			worker.terminate.mockImplementation(() => controller.abort())
			return worker
		}
	}
}
