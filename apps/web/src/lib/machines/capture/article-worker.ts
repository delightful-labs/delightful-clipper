/// <reference lib="webworker" />
import { createActor } from 'xstate'
import { createArticleQueueMachine } from './article-queue.js'
import { extractedCandidate, resolvedUrl } from '../../capture/source.js'
import type {
	QueueCapability,
	RpcReply,
	WorkerCall,
	WorkerInput,
	WorkerOutput
} from '../../contracts/article-worker.js'
const pending = new Map<
	string,
	{ resolve: (reply: RpcReply) => void; reject: (error: Error) => void }
>()
const post = (message: WorkerOutput) => self.postMessage(message)
function call(
	request:
		| Omit<Extract<WorkerCall, { method: 'resolve' | 'extract' }>, 'id'>
		| Omit<Extract<WorkerCall, { method: 'document' | 'intent' }>, 'id'>
		| Omit<Extract<WorkerCall, { method: 'save' }>, 'id'>
		| Omit<Extract<WorkerCall, { method: 'fail' }>, 'id'>,
	signal?: AbortSignal
): Promise<RpcReply> {
	const id = crypto.randomUUID()
	return new Promise((resolve, reject) => {
		const abort = () => {
			pending.delete(id)
			post({ type: 'CANCEL_CALL', id })
			reject(new Error('canceled'))
		}
		if (signal?.aborted) {
			reject(new Error('canceled'))
			return
		}
		pending.set(id, {
			resolve: (reply) => {
				signal?.removeEventListener('abort', abort)
				resolve(reply)
			},
			reject: (error) => {
				signal?.removeEventListener('abort', abort)
				reject(error)
			}
		})
		signal?.addEventListener('abort', abort, { once: true })
		post({ ...request, id })
	})
}
function json(bytes: Uint8Array, status: number): unknown {
	let value: unknown
	try {
		value = JSON.parse(new TextDecoder().decode(bytes))
	} catch {
		throw new Error('invalidResponse')
	}
	if (status < 200 || status >= 300) {
		if (
			value &&
			typeof value === 'object' &&
			'code' in value &&
			typeof value.code === 'string' &&
			[
				'invalidInput',
				'permissionDenied',
				'sessionUnavailable',
				'gatewayUnavailable',
				'rateLimited',
				'redirectBlocked',
				'redirectLoop',
				'fetchTimeout',
				'sourceUnavailable',
				'parseFailed',
				'sourceTooLarge',
				'unsupportedMedia',
				'canceled'
			].includes(value.code)
		)
			throw new Error(value.code)
		throw new Error('invalidResponse')
	}
	return value
}
function capability(libraryId: string): QueueCapability {
	return {
		libraryId,
		resolve: async (url, id, signal) => {
			const reply = await call({ type: 'CALL', method: 'resolve', url, requestId: id }, signal)
			if (reply.method !== 'resolve') throw new Error('invalidResponse')
			return resolvedUrl(json(reply.bytes, reply.status), id)
		},
		extract: async (url, id, signal) => {
			const reply = await call({ type: 'CALL', method: 'extract', url, requestId: id }, signal)
			if (reply.method !== 'extract') throw new Error('invalidResponse')
			return {
				...extractedCandidate(json(reply.bytes, reply.status), id, url),
				id
			}
		},
		document: async (id, signal) => {
			const r = await call({ type: 'CALL', method: 'document', operationId: id }, signal)
			if (r.method !== 'document') throw new Error('invalidResponse')
			return r.exists
		},
		intent: async (id, signal) => {
			const r = await call({ type: 'CALL', method: 'intent', operationId: id }, signal)
			if (r.method !== 'intent') throw new Error('invalidResponse')
			return r.exists
		},
		save: async (request) => {
			const r = await call({ type: 'CALL', method: 'save', request })
			if (r.method !== 'save') throw new Error('invalidResponse')
			return r.result
		},
		fail: async (id, code) => {
			await call({ type: 'CALL', method: 'fail', articleId: id, code })
		},
		report: post
	}
}
let actor: ReturnType<typeof createActor<ReturnType<typeof createArticleQueueMachine>>> | undefined
let rows: import('../../contracts/articles.js').Article[] = []
let stopped = false
self.onmessage = (event: MessageEvent<WorkerInput>) => {
	const message = event.data
	if (message.type === 'INIT') {
		// The lock lasts until the host has drained SDK writes and terminates this worker.
		void navigator.locks.request('clipper.article-queue:' + message.libraryId, async () => {
			if (stopped) return
			actor = createActor(createArticleQueueMachine(capability(message.libraryId))).start()
			actor.send({ type: 'ROWS', rows })
			await new Promise<void>(() => {})
		})
		return
	}
	if (message.type === 'ROWS') rows = message.rows
	if (message.type === 'STOP') stopped = true

	if (message.type === 'REPLY') {
		pending.get(message.id)?.resolve(message.reply)
		pending.delete(message.id)
		return
	}
	if (message.type === 'ERROR') {
		pending.get(message.id)?.reject(new Error(message.code))
		pending.delete(message.id)
		return
	}
	actor?.send(message)
}
