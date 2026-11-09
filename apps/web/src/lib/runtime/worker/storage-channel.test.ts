import { expect, it } from 'vitest'
import { accountStorageClient, serveAccountStorage } from './storage-channel.js'

it('keeps concurrent private storage replies correlated and only accesses the bound key', async () => {
	const channel = new MessageChannel()
	let value: string | null = 'existing identity'
	const keys: string[] = []
	const release = serveAccountStorage(
		channel.port1,
		{
			getItem: (key) => {
				keys.push(key)
				return value
			},
			setItem: (key, next) => {
				keys.push(key)
				value = next
			}
		},
		'private-bound-key'
	)
	const storage = accountStorageClient(channel.port2)
	try {
		const before = storage.read()
		const written = storage.write('updated identity')
		const after = storage.read()
		expect(await before).toBe('existing identity')
		await written
		expect(await after).toBe('updated identity')
		expect(keys).toEqual(['private-bound-key', 'private-bound-key', 'private-bound-key'])
	} finally {
		storage.close()
		release()
	}
})

it('returns a private generic failure when native storage refuses the operation', async () => {
	const channel = new MessageChannel()
	const release = serveAccountStorage(
		channel.port1,
		{
			getItem: () => {
				throw new Error('private credential must never cross the reply boundary')
			},
			setItem: () => {
				throw new Error('private quota error')
			}
		},
		'private-bound-key'
	)
	const storage = accountStorageClient(channel.port2)
	try {
		await expect(storage.read()).rejects.toThrow('Account storage unavailable')
		await expect(storage.write('private value')).rejects.toThrow('Account storage unavailable')
	} finally {
		storage.close()
		release()
	}
})

it('rejects pending and subsequent reads when the worker storage channel closes', async () => {
	const channel = new MessageChannel()
	const storage = accountStorageClient(channel.port2)
	const pending = expect(storage.read()).rejects.toThrow('Account storage closed')
	storage.close()
	await pending
	await expect(storage.read()).rejects.toThrow('Account storage closed')
	channel.port1.close()
})
