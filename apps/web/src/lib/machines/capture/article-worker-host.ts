import { createActor, toPromise } from 'xstate'
import { inspectMachines } from '../../diagnostics/inspect.js'
import { debugEnabled } from '../../diagnostics/logger.js'
import type {
	QueueOpen,
	WorkerCall,
	WorkerInput,
	WorkerOutput,
	RpcReply
} from '../../contracts/article-worker.js'
import type { SaveArticleRequest } from '../../contracts/articles.js'
import type { LibraryRecords } from '../../backend/jazz/records.js'
/** I/O resource owned by the library callback actor. Capture sequencing stays in the worker. */
export function articleWorkerOpen(
	records: LibraryRecords,
	request: (mode: 'resolve' | 'extract', body: unknown, signal: AbortSignal) => Promise<Response>
): QueueOpen {
	return (report) => {
		const worker = new Worker(new URL('./article-worker.ts', import.meta.url), { type: 'module' })
		let closing = false
		let shutdown: Promise<void> | undefined
		const tasks = new Set<Promise<unknown>>()
		const writes = new Set<{ send: (event: { type: 'SHUTDOWN' }) => void }>()
		const controllers = new Map<string, AbortController>()
		const post = (message: WorkerInput) => worker.postMessage(message)
		const check = () => {
			if (closing || !records.isCurrent()) throw new Error('scopeChanged')
		}
		async function save(input: SaveArticleRequest) {
			check()
			const actor = createActor(records.articles.saveMachine, { input, inspect: inspectMachines })
			writes.add(actor)
			actor.start()
			try {
				const result = await toPromise(actor)
				if (!closing && records.isCurrent()) report({ type: 'BACKGROUND_SAVED', result })
				return {
					kind: result.kind,
					operationId: result.operationId,
					ready: 'ready' in result && result.ready === true
				}
			} finally {
				writes.delete(actor)
				actor.stop()
			}
		}
		async function fail(id: string, code: string | null) {
			check()
			const actor = createActor(records.articles.failure, {
				inspect: inspectMachines,
				input: {
					attempt: {
						operationId: crypto.randomUUID(),
						workspaceId: id,
						membershipId: id,
						draft: { id, code }
					}
				}
			})
			writes.add(actor)
			actor.start()
			try {
				const result = await toPromise(actor)
				if (result.settlement.kind === 'locallyPersisted')
					void result.settlement.workspace.global().catch(() => {})
			} finally {
				writes.delete(actor)
				actor.stop()
			}
		}
		async function execute(message: WorkerCall): Promise<RpcReply> {
			check()
			switch (message.method) {
				case 'resolve':
				case 'extract': {
					const controller = new AbortController()
					controllers.set(message.id, controller)
					try {
						const response = await request(
							message.method,
							{ protocolVersion: 1, operationId: message.requestId, url: message.url },
							controller.signal
						)
						check()
						const reader = response.body?.getReader()
						if (!reader) throw new Error('invalidResponse')
						const chunks: Uint8Array[] = []
						let size = 0
						const abort = () => {
							void reader.cancel().catch(() => {})
						}
						controller.signal.addEventListener('abort', abort, { once: true })
						try {
							for (;;) {
								const next = await reader.read()
								if (next.done) break
								size += next.value.byteLength
								if (size > 5 * 1024 * 1024) throw new Error('sourceTooLarge')
								chunks.push(next.value)
							}
						} finally {
							controller.signal.removeEventListener('abort', abort)
							await reader.cancel().catch(() => {})
							reader.releaseLock()
						}
						check()
						controller.signal.throwIfAborted()
						const bytes = new Uint8Array(size)
						let offset = 0
						for (const chunk of chunks) {
							bytes.set(chunk, offset)
							offset += chunk.length
						}
						return { method: message.method, bytes, status: response.status }
					} finally {
						controllers.delete(message.id)
					}
				}
				case 'document':
					return { method: 'document', exists: await records.hasDocument(message.operationId) }
				case 'intent':
					return { method: 'intent', exists: await records.hasIntent(message.operationId) }
				case 'save':
					return { method: 'save', result: await save(message.request) }
				case 'fail':
					await fail(message.articleId, message.code)
					return { method: 'fail' }
			}
		}
		function track<T>(promise: Promise<T>) {
			tasks.add(promise)
			void promise.finally(() => tasks.delete(promise)).catch(() => {})
			return promise
		}
		post({ type: 'INIT', libraryId: records.articles.libraryId, debug: debugEnabled })
		const unsubscribe = records.articles.subscribePending(
			(rows) => {
				if (!closing) post({ type: 'ROWS', rows })
			},
			() => {
				if (!closing) report({ type: 'BACKGROUND_ERROR' })
			}
		)
		let online = navigator.onLine
		const offline = () => {
			online = false
		}
		const wake = () => {
			if (!online) {
				online = true
				if (!closing) post({ type: 'WAKE' })
			}
		}
		window.addEventListener('offline', offline)
		window.addEventListener('online', wake)
		worker.onmessage = (event: MessageEvent<WorkerOutput>) => {
			const message = event.data
			if (message.type === 'CANCEL_CALL') {
				controllers.get(message.id)?.abort()
				return
			}
			if (closing || !records.isCurrent()) return
			if (message.type === 'STATUS') {
				report({
					type: 'BACKGROUND_STATUS',
					id: message.id,
					message: message.message,
					cancelable: message.cancelable
				})
				return
			}
			void track(
				execute(message)
					.then((reply) => {
						if (!closing) post({ type: 'REPLY', id: message.id, reply })
					})
					.catch((error: unknown) => {
						if (!closing)
							post({
								type: 'ERROR',
								id: message.id,
								code:
									error instanceof Error &&
									[
										'scopeChanged',
										'sessionUnavailable',
										'rateLimited',
										'sourceTooLarge',
										'invalidResponse',
										'captureFailed'
									].includes(error.message)
										? error.message
										: 'networkUnavailable'
							})
					})
			)
		}
		worker.onerror = () => {
			if (!closing) report({ type: 'BACKGROUND_ERROR' })
			void stop()
		}
		function stop(): Promise<void> {
			if (shutdown) return shutdown
			closing = true
			unsubscribe()
			window.removeEventListener('offline', offline)
			window.removeEventListener('online', wake)
			post({ type: 'STOP' })
			for (const controller of controllers.values()) controller.abort()
			for (const actor of writes) actor.send({ type: 'SHUTDOWN' })
			shutdown = Promise.allSettled(tasks).then(() => {
				worker.onmessage = null
				worker.onerror = null
				worker.terminate()
				report({ type: 'BACKGROUND_CLOSED' })
			})
			return shutdown
		}
		return {
			stop,
			send: (event) => {
				if (event.type === 'STOP') {
					void stop()
					return
				}
				if (closing) return
				if (event.type === 'RETRY') {
					void track(
						fail(event.id, null)
							.then(() => {
								if (!closing) post(event)
							})
							.catch(() => {
								if (!closing) report({ type: 'BACKGROUND_ERROR' })
							})
					)
					return
				}
				post(event)
			}
		}
	}
}
