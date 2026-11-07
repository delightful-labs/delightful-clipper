/** Native connectivity events are exposed by both Window and WorkerGlobalScope.
 * Resolve at resource admission so hosts/tests retain their own event target. */
export function connectivityEvents(): Pick<
	EventTarget,
	'addEventListener' | 'removeEventListener'
> {
	return typeof window === 'undefined' ? globalThis : window
}
