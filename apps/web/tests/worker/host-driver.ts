import { serveBrokerHost } from '../../src/lib/runtime/worker/broker-channel.js'
import { currentLibraryRecords } from '../../src/lib/backend/jazz/account.js'
import { serveAccountStorage } from '../../src/lib/runtime/worker/storage-channel.js'
import { z } from 'zod'
const { PUBLIC_JAZZ_APP_ID, PUBLIC_JAZZ_SERVER_URL } = z
	.object({ PUBLIC_JAZZ_APP_ID: z.string(), PUBLIC_JAZZ_SERVER_URL: z.string().url() })
	.parse(import.meta.env)
import { accountRegistryUrl } from 'jazz-tools'
export async function qualifyHost() {
	const expected = currentLibraryRecords().articles.libraryId
	const key = `jazz-account-selection-v1:${encodeURIComponent(accountRegistryUrl(PUBLIC_JAZZ_SERVER_URL, PUBLIC_JAZZ_APP_ID))}:clipper`
	const worker = new Worker(new URL('./host.worker.ts', import.meta.url), { type: 'module' })
	const channel = new MessageChannel()
	const broker = new MessageChannel()
	const stopBroker = serveBrokerHost(broker.port1)
	const stop = serveAccountStorage(channel.port1, localStorage, key)
	try {
		return await new Promise((resolve, reject) => {
			let result: unknown
			worker.onerror = () => reject(new Error('Worker host failed'))
			worker.onmessage = ({ data }) => {
				if (data.type === 'FAILED')
					reject(
						new Error(
							'Worker host refused: ' + data.message + '; SharedWorker=' + data.sharedWorker
						)
					)
				if (data.type === 'READY') result = { ...data, sameAccount: data.accountId === expected }
				if (data.type === 'CLOSED') resolve(result)
			}
			worker.postMessage(
				{
					port: channel.port2,
					broker: broker.port2,
					appId: PUBLIC_JAZZ_APP_ID,
					serverUrl: PUBLIC_JAZZ_SERVER_URL
				},
				[channel.port2, broker.port2]
			)
		})
	} finally {
		stopBroker()
		stop()
		worker.terminate()
	}
}

/** Exercise the real application startup/domain machine in a dedicated worker. */
export async function qualifyApplicationHost(shutdownImmediately = false) {
	const key = `jazz-account-selection-v1:${encodeURIComponent(accountRegistryUrl(PUBLIC_JAZZ_SERVER_URL, PUBLIC_JAZZ_APP_ID))}:clipper`
	const worker = new Worker(
		new URL('../../src/lib/runtime/worker/application.worker.ts', import.meta.url),
		{ type: 'module' }
	)
	const storage = new MessageChannel(),
		broker = new MessageChannel()
	const stopStorage = serveAccountStorage(storage.port1, localStorage, key)
	const stopBroker = serveBrokerHost(broker.port1)
	try {
		return await new Promise((resolve, reject) => {
			let result: unknown
			worker.onerror = () => reject(new Error('Application worker failed'))
			worker.onmessage = ({ data }) => {
				if (data.type === 'FAILED') reject(new Error('Application worker refused'))
				if (data.type === 'VIEW' && data.library && !shutdownImmediately) {
					result = data
					worker.postMessage({ type: 'SHUTDOWN' })
				}
				if (data.type === 'CLOSED') resolve(shutdownImmediately ? { closed: true } : result)
			}
			worker.postMessage(
				{
					type: 'INITIALIZE',
					appId: PUBLIC_JAZZ_APP_ID,
					serverUrl: PUBLIC_JAZZ_SERVER_URL,
					storage: storage.port2,
					broker: broker.port2
				},
				[storage.port2, broker.port2]
			)
			if (shutdownImmediately) worker.postMessage({ type: 'SHUTDOWN' })
		})
	} finally {
		stopStorage()
		stopBroker()
		worker.terminate()
	}
}

export async function workerIntentExists(id: string) {
	return currentLibraryRecords().hasIntent(id)
}
