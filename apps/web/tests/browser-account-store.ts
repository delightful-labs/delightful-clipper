import { accountStorageKey } from '../src/lib/runtime/worker/storage-channel.js'
import { createWorkerAccountStore } from '../src/lib/runtime/worker/account-store.js'

/** Test-only Window access to the same namespace and lock as the production worker. */
export function browserAccountStore(serverUrl: string) {
	const key = accountStorageKey(serverUrl)
	return createWorkerAccountStore(key, {
		read: async () => localStorage.getItem(key),
		write: async (value) => {
			localStorage.setItem(key, value)
		}
	})
}

export function fixtureServerUrl() {
	const configured = import.meta.env.PUBLIC_JAZZ_SERVER_URL
	return new URL(configured === 'same-origin' ? '/jazz' : configured, location.origin).href
}
