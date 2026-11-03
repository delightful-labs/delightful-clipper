import { self } from '$app/service-worker'
import { version } from '$app/env'
import { assets, immutable } from '$app/manifest'
import { createActor, toPromise } from 'xstate'
import { shellCacheMachine } from '../lib/machines/offline/cache.js'
import {
	SHELL_CACHE_PREFIX,
	obsoleteShellCaches,
	publicAssetResponse,
	shellKey,
	shellPolicy
} from '../lib/offline/policy.js'
const policy = shellPolicy(
	self.registration.scope,
	version,
	immutable.map((asset) => asset.path),
	assets.map((asset) => asset.path)
)
async function reuse(path: string) {
	if (!policy.immutable.has(path)) return undefined
	for (const name of await caches.keys())
		if (name.startsWith(SHELL_CACHE_PREFIX)) {
			const response = await (await caches.open(name)).match(path)
			if (response && publicAssetResponse(path, response)) return response
		}
	return undefined
}
const port = {
	populate: async () => {
		const cache = await caches.open(policy.cacheName)
		// Drain every issued fetch/put before failed-install cleanup can delete the cache.
		const outcomes = await Promise.allSettled(
			Array.from(policy.paths, async (path) => {
				const response =
					(await reuse(path)) ??
					(await fetch(
						new Request(path, {
							credentials: 'omit',
							cache: 'no-cache',
							redirect: 'error',
							signal: AbortSignal.timeout(30000)
						})
					))
				if (!publicAssetResponse(path, response)) {
					await response.body?.cancel()
					throw new Error('Invalid public shell response')
				}
				await cache.put(path, response)
			})
		)
		if (outcomes.some((outcome) => outcome.status === 'rejected'))
			throw new Error('Shell population failed')
	},
	discard: async () => {
		await caches.delete(policy.cacheName)
	},
	obsolete: async () => obsoleteShellCaches(await caches.keys(), policy.cacheName),
	remove: async (names: string[]) => {
		const outcomes = await Promise.allSettled(names.map((name) => caches.delete(name)))
		if (outcomes.some((outcome) => outcome.status === 'rejected'))
			throw new Error('Shell cleanup incomplete')
	},
	claim: () => self.clients.claim()
}
async function run(mode: 'install' | 'activate') {
	const actor = createActor(shellCacheMachine, { input: { mode, port } }).start()
	try {
		if ((await toPromise(actor)) !== 'ready') throw new Error('Offline shell unavailable')
	} finally {
		actor.stop()
	}
}
self.addEventListener('install', (event) => event.waitUntil(run('install')))
self.addEventListener('activate', (event) => event.waitUntil(run('activate')))
self.addEventListener('fetch', (event) => {
	const key = shellKey(policy, event.request)
	if (!key) return
	// A cache miss falls back to network without caching arbitrary runtime responses.
	event.respondWith(
		caches
			.open(policy.cacheName)
			.then(async (cache) => (await cache.match(key)) ?? fetch(event.request))
	)
})
// Deliberately no skipWaiting: old tabs keep their build until they have all closed.
