import type { SearchResource } from '../contracts/search.js'
import { searchWorkerOutputSchema } from './protocol.js'
import type { SearchWorkerOutput } from './protocol.js'
/** Resource-only adapter. No SDK/account state or indexing policy runs in page callbacks. */
export function openSearchWorker(report: (event: SearchWorkerOutput) => void): SearchResource {
	const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
	worker.onmessage = (event: MessageEvent<unknown>) => {
		const parsed = searchWorkerOutputSchema.safeParse(event.data)
		report(parsed.success ? parsed.data : { type: 'WORKER_ERROR' })
	}
	worker.onerror = () => report({ type: 'WORKER_ERROR' })
	worker.onmessageerror = () => report({ type: 'WORKER_ERROR' })
	return {
		post: (message) => worker.postMessage(message),
		dispose: () => {
			worker.onmessage = null
			worker.onerror = null
			worker.onmessageerror = null
			worker.terminate()
		}
	}
}
