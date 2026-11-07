import { connectivityEvents } from '../../offline/connectivity.js'
import type { LibraryRecords } from '../../backend/jazz/records.js'
import type { HostResource, HostResourceEvent } from './article-worker-host.js'
/** Browser resource adapter only. Admission, call ownership and shutdown ordering belong to the host machine. */
export function openArticleWorkerBrowser(
	records: LibraryRecords,
	report: (event: HostResourceEvent) => void
): HostResource {
	const worker = new Worker(new URL('./article-worker.ts', import.meta.url), { type: 'module' })
	let unsubscribe: (() => void) | undefined
	const offline = () => report({ type: 'CONNECTIVITY', online: false })
	const online = () => report({ type: 'CONNECTIVITY', online: true })
	worker.onmessage = (event) =>
		event.data.type === 'WORKER_FAILED'
			? report({ type: 'RESOURCE_ERROR' })
			: report({ type: 'WORKER_MESSAGE', message: event.data })
	worker.onerror = () => report({ type: 'RESOURCE_ERROR' })
	const quiesce = () => {
		const release = unsubscribe
		unsubscribe = undefined
		try {
			release?.()
		} finally {
			connectivityEvents().removeEventListener('offline', offline)
			connectivityEvents().removeEventListener('online', online)
			worker.postMessage({ type: 'STOP' })
		}
	}

	return {
		post: (message) => worker.postMessage(message),
		observe: () => {
			unsubscribe = records.articles.subscribePending(
				(rows) => report({ type: 'PENDING_ROWS', rows }),
				() => report({ type: 'RESOURCE_ERROR' })
			)
			connectivityEvents().addEventListener('offline', offline)
			connectivityEvents().addEventListener('online', online)
		},
		quiesce,
		dispose: () => {
			try {
				quiesce()
			} finally {
				worker.onmessage = null
				worker.onerror = null
				worker.terminate()
			}
		}
	}
}
