/// <reference lib="webworker" />
import { createActor, toPromise } from 'xstate'
import { createLibraryRecords } from '../../src/lib/backend/jazz/records.js'
import { brokerHostClient } from '../../src/lib/runtime/worker/broker-channel.js'
import { diagnosticText } from '../../src/lib/diagnostics/machines.js'
import { createJazzClient } from 'jazz-tools/client'
import wasmUrl from '#jazz-wasm-binary?url'
import { app } from '../../src/lib/backend/jazz/schema.js'
import { createWorkerAccountStore } from '../../src/lib/runtime/worker/account-store.js'
import {
	accountStorageClient,
	accountStorageKey
} from '../../src/lib/runtime/worker/storage-channel.js'
import { JAZZ_RUNTIME_VERSION } from '../../src/lib/offline/runtime-version.js'
self.onmessage = async ({ data }) => {
	const storage = accountStorageClient(data.port)
	const brokerHost = brokerHostClient(data.broker)
	try {
		const key = accountStorageKey(data.serverUrl)
		const session = await createJazzClient({
			client: () => import('jazz-tools/local-first'),
			serverUrl: data.serverUrl,
			env: 'clipper',
			initial: 'local-first',
			store: createWorkerAccountStore(key, storage),
			runtimeSources: { browserWorkerHost: brokerHost, wasmUrl, wasmVersion: JAZZ_RUNTIME_VERSION }
		})
		try {
			await session
				.getSnapshot()
				.client?.db.upgradeToLocalFirst(() => import('jazz-tools/local-first'))
			const { account, client } = session.getSnapshot()
			if (!account || !client) throw new Error('Worker account unavailable')
			const before = await client.db.one(app.libraries.where({ id: account.id }), {
				tier: 'local-first'
			})
			const documentId = crypto.randomUUID()
			const write = client.db.insert(
				app.storageOperations,
				{
					libraryId: account.id,
					payloadHash: 'worker-host-proof',
					createdAt: new Date().toISOString()
				},
				{ id: documentId }
			)
			await write.wait({ tier: 'local' })
			const after = await client.db.one(app.storageOperations.where({ id: documentId }), {
				tier: 'local-first'
			})
			const records = createLibraryRecords(
				client.db,
				account.id,
				() => session.getSnapshot().client === client
			)
			const saving = createActor(records.articles.saveMachine, {
				input: {
					url: 'https://example.com/worker-proof',
					content: {
						title: 'Worker proof',
						text: 'Saved in a worker.',
						html: '<p>Saved in a worker.</p>',
						finalUrl: 'https://example.com/worker-proof',
						provenance: '{}'
					}
				}
			}).start()
			let saved: boolean
			try {
				saved = (await toPromise(saving)).kind === 'saved'
			} finally {
				saving.stop()
			}
			self.postMessage({
				type: 'READY' as const,
				accountId: account.id,
				existing: !!before,
				domainSaved: saved,
				written: after?.payloadHash === 'worker-host-proof',
				windowPresent: typeof window !== 'undefined',
				sharedWorker: typeof SharedWorker,
				operationId: documentId
			})
		} finally {
			await session.close()
		}
	} catch (error) {
		self.postMessage({
			type: 'FAILED' as const,
			message: diagnosticText(error instanceof Error ? error.message : 'Unknown worker failure'),
			sharedWorker: typeof SharedWorker
		})
	} finally {
		brokerHost.close()
		storage.close()
		self.postMessage({ type: 'CLOSED' as const })
	}
}
