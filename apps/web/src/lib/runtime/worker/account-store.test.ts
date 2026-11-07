import { locks } from 'node:worker_threads'
import { afterEach, expect, it, vi } from 'vitest'
import { createWorkerAccountStore } from './account-store.js'

afterEach(() => vi.unstubAllGlobals())

it('holds the native account lock until the write acknowledges and serializes competing SDK transforms', async () => {
	vi.stubGlobal('navigator', { locks })
	const durable = Promise.withResolvers<void>()
	let value: string | null = null
	const storage = {
		read: vi.fn(async () => value),
		write: vi.fn(async (replacement: string) => {
			if (replacement === 'first') await durable.promise
			value = replacement
		})
	}
	const key = crypto.randomUUID()
	const first = createWorkerAccountStore(key, storage)
	const second = createWorkerAccountStore(key, storage)
	const following = vi.fn((current: string | null) => `${current}:second`)
	const writing = first.update(() => 'first')
	await vi.waitFor(() => expect(storage.write).toHaveBeenCalledWith('first'))
	const queued = second.update(following)
	await new Promise<void>((resolve) => setImmediate(resolve))
	expect(following).not.toHaveBeenCalled()
	expect(value).toBeNull()
	durable.resolve()
	await Promise.all([writing, queued])
	expect(following).toHaveBeenCalledWith('first')
	expect(value).toBe('first:second')
})

it.each(['read', 'transform', 'write'])(
	'releases the native account lock after a %s failure without replaying the failed update',
	async (phase) => {
		vi.stubGlobal('navigator', { locks })
		let value: string | null = null
		const storage = {
			read: vi.fn(async () => value),
			write: vi.fn(async (replacement: string) => {
				value = replacement
			})
		}
		const transform = vi.fn(() => 'failed update')
		if (phase === 'read') storage.read.mockRejectedValueOnce(new Error('Private storage error'))
		if (phase === 'transform')
			transform.mockImplementationOnce(() => {
				throw new Error('Private transform error')
			})
		if (phase === 'write') storage.write.mockRejectedValueOnce(new Error('Private write error'))
		const store = createWorkerAccountStore(crypto.randomUUID(), storage)
		await expect(store.update(transform)).rejects.toThrow('Account storage update failed')
		expect(value).toBeNull()
		const failedCalls = transform.mock.calls.length
		await store.update((current) => `${current ?? 'empty'}:next`)
		expect(transform).toHaveBeenCalledTimes(failedCalls)
		expect(value).toBe('empty:next')
	}
)
