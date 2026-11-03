import type {
	ShellEvent,
	ShellRegistration,
	ShellWorker
} from '../machines/offline/registration.js'
/** Browser event translation only; registration/status ownership belongs to its actor. */
export function observeShell(registration: ShellRegistration, report: (event: ShellEvent) => void) {
	const watched = new Set<ShellWorker>()
	const inspect = () => {
		const current = new Set(
			[registration.installing, registration.waiting, registration.active].filter(
				(worker) => worker !== null
			)
		)
		const failed = Array.from(new Set([...watched, ...current])).some(
			(worker) => worker.state === 'redundant'
		)
		for (const worker of watched)
			if (!current.has(worker)) {
				worker.removeEventListener('statechange', inspect)
				watched.delete(worker)
			}
		for (const worker of current)
			if (!watched.has(worker)) {
				worker.addEventListener('statechange', inspect)
				watched.add(worker)
			}
		const status = registration.waiting
			? 'waiting'
			: registration.active?.state === 'activated'
				? 'ready'
				: failed
					? 'failed'
					: 'preparing'
		report({ type: 'STATUS', status })
	}
	registration.addEventListener('updatefound', inspect)
	inspect()
	return () => {
		registration.removeEventListener('updatefound', inspect)
		for (const worker of watched) worker.removeEventListener('statechange', inspect)
		watched.clear()
	}
}
