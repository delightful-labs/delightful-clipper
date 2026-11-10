import { locks } from 'node:worker_threads'
import { afterEach, expect, it, vi } from 'vitest'
import { createAccountManager } from 'jazz-tools'
import { extensionAccountStorageKey } from './account-storage.js'
import { createWorkerAccountStore } from '../../web/src/lib/runtime/worker/account-store.js'

afterEach(() => vi.unstubAllGlobals())

it.each(['https://clipper.example/jazz', 'https://clipper.example/jazz/'])(
	'reopens the SDK browser selection from the worker without copying or replacing it (%s)',
	async (serverUrl) => {
		const values = new Map<string, string>()
		vi.stubGlobal('navigator', { locks })
		vi.stubGlobal('localStorage', {
			getItem: (key: string) => values.get(key) ?? null,
			setItem: (key: string, value: string) => values.set(key, value)
		})
		const native = await createAccountManager({ serverUrl, env: 'clipper' })
		const original = native.createLocalFirst()
		await native.settleSelection()
		const key = extensionAccountStorageKey(serverUrl)
		expect([...values.keys()]).toEqual([key])
		const selection = values.get(key)
		const worker = await createAccountManager({
			serverUrl,
			env: 'clipper',
			store: createWorkerAccountStore(key, {
				read: async () => values.get(key) ?? null,
				write: async (value) => {
					values.set(key, value)
				}
			})
		})
		expect(worker.getSnapshot().account?.id).toBe(original.id)
		expect(values.get(key)).toBe(selection)
		worker.createLocalFirst()
		await worker.settleSelection()
		const reopened = await createAccountManager({ serverUrl, env: 'clipper' })
		expect(reopened.getSnapshot().account?.id).toBe(worker.getSnapshot().account?.id)
		expect([...values.keys()]).toEqual([key])
	}
)
