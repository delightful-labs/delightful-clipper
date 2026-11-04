import type { RuntimeCapability, SharedControl } from './article-worker-runtime.js'
/** Browser coordination I/O only. The runtime machine decides when to claim, route and stop. */
export function workerCoordination(
	libraryId: string
): Pick<RuntimeCapability, 'claim' | 'channel'> {
	const name = 'clipper.article-queue:' + libraryId
	return {
		claim: (report) => {
			const controller = new AbortController()
			let release: (() => void) | undefined
			void navigator.locks
				.request(name, { signal: controller.signal }, async () => {
					report({ type: 'LOCKED' })
					await new Promise<void>((resolve) => {
						release = resolve
					})
				})
				.catch(() => {
					if (!controller.signal.aborted) report({ type: 'LOCK_FAILED' })
				})
			return {
				cancel: () => controller.abort(),
				release: () => {
					controller.abort()
					release?.()
				}
			}
		},
		channel: (report) => {
			const channel = new BroadcastChannel(name)
			channel.onmessage = (event: MessageEvent<SharedControl>) => report(event.data)
			return {
				post: (message) => channel.postMessage(message),
				close: () => {
					channel.onmessage = null
					channel.close()
				}
			}
		}
	}
}
