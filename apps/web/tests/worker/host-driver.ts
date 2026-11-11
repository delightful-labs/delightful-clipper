import { serveScopedAccountStorage } from '../../src/lib/runtime/worker/scoped-storage-channel.js'
import { serveBrokerHost } from '../../src/lib/runtime/worker/broker-channel.js'
import {
	serveAccountStorage,
	accountStorageKey
} from '../../src/lib/runtime/worker/storage-channel.js'
import { z } from 'zod'
import { fixtureServerUrl } from '../browser-account-store.js'
const { PUBLIC_JAZZ_APP_ID } = z.object({ PUBLIC_JAZZ_APP_ID: z.string() }).parse(import.meta.env)
const PUBLIC_JAZZ_SERVER_URL = fixtureServerUrl()
function serveNativeBroker(data: MessagePort, control: MessagePort, scope: string) {
	return serveBrokerHost(data, control, scope, {
		origin: location.origin,
		storage: localStorage,
		open: (url, name) => new SharedWorker(url, { type: 'module', name })
	})
}
export async function qualifyHost() {
	const { currentLibraryRecords } = await import('../fixture-records.js')
	const expected = currentLibraryRecords().articles.libraryId
	const key = accountStorageKey(PUBLIC_JAZZ_SERVER_URL)
	const worker = new Worker(new URL('./host.worker.ts', import.meta.url), { type: 'module' })
	const channel = new MessageChannel()
	const broker = new MessageChannel(),
		brokerControl = new MessageChannel()
	const brokerScope = crypto.randomUUID()
	const stopBroker = serveNativeBroker(broker.port1, brokerControl.port1, brokerScope)
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
					brokerControl: brokerControl.port2,
					brokerScope,
					appId: PUBLIC_JAZZ_APP_ID,
					serverUrl: PUBLIC_JAZZ_SERVER_URL
				},
				[channel.port2, broker.port2, brokerControl.port2]
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
	const key = accountStorageKey(PUBLIC_JAZZ_SERVER_URL)
	const worker = new Worker(
		new URL('../../src/lib/runtime/worker/application.worker.ts', import.meta.url),
		{ type: 'module' }
	)
	const storage = new MessageChannel(),
		storageControl = new MessageChannel(),
		broker = new MessageChannel(),
		brokerControl = new MessageChannel()
	const brokerScope = crypto.randomUUID()
	const storageScope = crypto.randomUUID()
	const stopStorage = serveScopedAccountStorage(
		storage.port1,
		storageControl.port1,
		storageScope,
		localStorage,
		key
	)
	const stopBroker = serveNativeBroker(broker.port1, brokerControl.port1, brokerScope)
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
					storageControl: storageControl.port2,
					storageScope,
					broker: broker.port2,
					brokerControl: brokerControl.port2,
					brokerScope
				},
				[storage.port2, storageControl.port2, broker.port2, brokerControl.port2]
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
	const { currentLibraryRecords } = await import('../fixture-records.js')
	return currentLibraryRecords().hasIntent(id)
}

export async function qualifyScopedCommands() {
	const key = accountStorageKey(PUBLIC_JAZZ_SERVER_URL)
	const worker = new Worker(
		new URL('../../src/lib/runtime/worker/application.worker.ts', import.meta.url),
		{ type: 'module' }
	)
	const storage = new MessageChannel(),
		storageControl = new MessageChannel(),
		broker = new MessageChannel(),
		brokerControl = new MessageChannel()
	const brokerScope = crypto.randomUUID()
	const storageScope = crypto.randomUUID()
	const stopStorage = serveScopedAccountStorage(
			storage.port1,
			storageControl.port1,
			storageScope,
			localStorage,
			key
		),
		stopBroker = serveNativeBroker(broker.port1, brokerControl.port1, brokerScope)
	try {
		return await new Promise((resolve, reject) => {
			let sent = false
			let urls: string[] = []
			let closing = false
			worker.onerror = () => reject(new Error('Worker command qualification failed'))
			worker.onmessage = ({ data }) => {
				if (data.type === 'FAILED') reject(new Error('Worker command owner failed'))
				if (data.type === 'VIEW' && data.library && !closing) {
					if (!sent) {
						sent = true
						worker.postMessage({
							type: 'LIBRARY',
							scope: crypto.randomUUID(),
							requestId: crypto.randomUUID(),
							event: { type: 'ADD', url: 'https://example.com/stale-binding' }
						})
						worker.postMessage({
							type: 'LIBRARY',
							scope: data.library.scope,
							requestId: crypto.randomUUID(),
							event: { type: 'ADD', url: 'https://example.com/current-binding' }
						})
					}
					urls = data.library.rows.map((row: { url: string }) => row.url)
					if (urls.includes('https://example.com/current-binding')) {
						closing = true
						worker.postMessage({ type: 'SHUTDOWN' })
					}
				}
				if (data.type === 'CLOSED')
					resolve({
						valid: urls.includes('https://example.com/current-binding'),
						stale: urls.includes('https://example.com/stale-binding')
					})
			}
			worker.postMessage(
				{
					type: 'INITIALIZE',
					appId: PUBLIC_JAZZ_APP_ID,
					serverUrl: PUBLIC_JAZZ_SERVER_URL,
					storage: storage.port2,
					storageControl: storageControl.port2,
					storageScope,
					broker: broker.port2,
					brokerControl: brokerControl.port2,
					brokerScope
				},
				[storage.port2, storageControl.port2, broker.port2, brokerControl.port2]
			)
		})
	} finally {
		stopStorage()
		stopBroker()
		worker.terminate()
	}
}
