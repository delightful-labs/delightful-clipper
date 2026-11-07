/// <reference lib="webworker" />
import { createActor } from 'xstate'
import type { AnyActorRef } from 'xstate'
import { z } from 'zod'
import { accountRegistryUrl } from 'jazz-tools'
import wasmUrl from '#jazz-wasm-binary?url'
import { accountInput } from '../../backend/jazz/account.js'
import { JAZZ_RUNTIME_VERSION } from '../../offline/runtime-version.js'
import {
	selectApplicationView,
	selectLibraryActor
} from '../../machines/runtime/application-readiness.js'
import { selectLibraryView } from '../../machines/capture/library.js'
import { workerHostMachine } from './host-machine.js'
import type { WorkerHost } from './host-machine.js'
import { createWorkerAccountStore } from './account-store.js'
import { accountStorageClient } from './storage-channel.js'
import { brokerHostClient } from './broker-channel.js'

const initialize = z.object({
	type: z.literal('INITIALIZE'),
	appId: z.string().uuid(),
	serverUrl: z.string().url(),
	storage: z.instanceof(MessagePort),
	broker: z.instanceof(MessagePort)
})
const command = z.discriminatedUnion('type', [
	z.object({ type: z.literal('SHUTDOWN') }),
	z.object({
		type: z.literal('ACCOUNT'),
		event: z.discriminatedUnion('type', [
			z.object({ type: z.enum(['CREATE', 'LOGOUT', 'RETRY']) }),
			z.object({ type: z.literal('RESTORE'), phrase: z.string().max(4096) })
		])
	})
])
let host: WorkerHost | undefined
const subscriptions = new Map<AnyActorRef, { unsubscribe: () => void }>()

self.onmessage = ({ data }: MessageEvent<unknown>) => {
	if (host) {
		const decoded = command.safeParse(data)
		if (decoded.success) host.send(decoded.data)
		return
	}
	const decoded = initialize.safeParse(data)
	if (!decoded.success) return
	const { appId, serverUrl, storage: storagePort, broker: brokerPort } = decoded.data
	const storage = accountStorageClient(storagePort)
	const broker = brokerHostClient(brokerPort)
	const key = `jazz-account-selection-v1:${encodeURIComponent(accountRegistryUrl(serverUrl, appId))}:clipper`
	const input = accountInput({
		appId,
		serverUrl,
		env: 'clipper',
		store: createWorkerAccountStore(key, storage),
		runtimeSources: { wasmUrl, wasmVersion: JAZZ_RUNTIME_VERSION, browserWorkerHost: broker }
	})
	const actor = createActor(workerHostMachine, { input })
	host = actor
	const publish = () => {
		if (actor.getSnapshot().matches('failed')) {
			self.postMessage({ type: 'FAILED' })
			return
		}
		const application = actor.getSnapshot().children.application
		const snapshot = application?.getSnapshot()
		const library = selectLibraryActor(snapshot)
		const watched: AnyActorRef[] = [
			application,
			library,
			...Object.values(library?.getSnapshot().children ?? {})
		].filter((value) => value !== undefined)
		for (const [reference, subscription] of subscriptions) {
			if (!watched.includes(reference)) {
				subscription.unsubscribe()
				subscriptions.delete(reference)
			}
		}
		for (const reference of watched) {
			if (!subscriptions.has(reference)) subscriptions.set(reference, reference.subscribe(publish))
		}
		const view = selectLibraryView(library?.getSnapshot(), false)
		// Bounded projection only. Never send account/session/DB/actor contexts or
		// credentials through the render channel. Full reader UI port follows separately.
		self.postMessage({
			type: 'VIEW',
			account: selectApplicationView(snapshot, true),
			library: library
				? { rows: view.rows.slice(0, 50), total: view.rows.length, listMessage: view.listMessage }
				: undefined,
			worker: { windowPresent: typeof window !== 'undefined' }
		})
	}
	actor.subscribe({
		next: publish,
		complete: () => {
			for (const subscription of subscriptions.values()) subscription.unsubscribe()
			subscriptions.clear()
			storage.close()
			broker.close()
			self.postMessage({ type: 'CLOSED' })
		},
		error: () => self.postMessage({ type: 'FAILED' })
	})
	actor.start()
}
