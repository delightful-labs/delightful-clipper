import type { Source } from './protocol.js'
export function extractSource(source: Source, signal: AbortSignal): Promise<unknown> {
	return new Promise((resolve, reject) => {
		const worker = new Worker(new URL('./extract-worker.ts', import.meta.url), { type: 'module' })
		const close = () => {
			signal.removeEventListener('abort', abort)
			worker.terminate()
		}
		const abort = () => {
			close()
			reject(new DOMException('Aborted', 'AbortError'))
		}
		worker.onmessage = (event) => {
			close()
			resolve(event.data.content)
		}
		worker.onerror = () => {
			close()
			reject(new Error('captureFailed'))
		}
		signal.addEventListener('abort', abort, { once: true })
		if (signal.aborted) {
			abort()
			return
		}
		worker.postMessage(source)
	})
}
