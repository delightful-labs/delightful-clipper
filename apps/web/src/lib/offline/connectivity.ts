/** Native platform facts only. Window supplies online/offline events because
 * Chromium does not deliver those transitions reliably to dedicated workers.
 * Every consumer's owning chart still decides retries, admission and status. */
let bridge: { events: EventTarget; online: boolean } | undefined
export function bindWorkerConnectivity(initial: boolean) {
	const current = { events: new EventTarget(), online: initial }
	bridge = current
	return (online: boolean) => {
		current.online = online
		current.events.dispatchEvent(new Event(online ? 'online' : 'offline'))
	}
}
export function isOnline() {
	return bridge?.online ?? navigator.onLine
}
export function connectivityEvents(): Pick<
	EventTarget,
	'addEventListener' | 'removeEventListener'
> {
	return bridge?.events ?? (typeof window === 'undefined' ? globalThis : window)
}
