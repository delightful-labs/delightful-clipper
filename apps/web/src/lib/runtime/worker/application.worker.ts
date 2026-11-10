import { imageUrlSchema } from '../../images/schema.js'
import { bindWorkerConnectivity } from '../../offline/connectivity.js'
/// <reference lib="webworker" />
import { createActor, type AnyActorRef } from 'xstate'

import { z } from 'zod'
import wasmUrl from '#jazz-wasm-binary?url'
import { accountInput } from '../../backend/jazz/account.js'
import { JAZZ_RUNTIME_VERSION } from '../../offline/runtime-version.js'
import {
	selectRecoveryBinding,
	selectLibraryActor
} from '../../machines/runtime/application-readiness.js'
import { remoteReaderSurface } from './reader-surface.js'
import { projectRuntime } from './views.js'
import { commandSchema } from './protocol.js'
import { recoveryView } from './recovery-owner.js'
import { inspectMachines } from '../../diagnostics/inspect.js'
import { workerHostMachine } from './host-machine.js'
import type { WorkerHost } from './host-machine.js'
import { createWorkerAccountStore } from './account-store.js'
import { accountStorageClient, accountStorageKey } from './storage-channel.js'
import { brokerHostClient } from './broker-channel.js'

let updateConnectivity: ((online: boolean) => void) | undefined
const initialize = z.object({
	online: z.boolean().optional(),
	type: z.literal('INITIALIZE'),
	appId: z.string().uuid(),
	serverUrl: z.string().url(),
	storage: z.instanceof(MessagePort),
	broker: z.instanceof(MessagePort)
})
let observedRecovery: object | undefined
let host: WorkerHost | undefined
let sentReader = ''
let observedLibrary: object | undefined
const surfaces = new Set<ReturnType<typeof remoteReaderSurface>>()
const subscriptions = new Map<AnyActorRef, { unsubscribe: () => void }>()

self.onmessage = ({ data }: MessageEvent<unknown>) => {
	if (host) {
		const decoded = commandSchema.safeParse(data)
		if (decoded.success) {
			const message = decoded.data
			if (message.type === 'CONNECTIVITY') updateConnectivity?.(message.online)
			else if (message.type === 'ATTACH') {
				if (
					message.scope !== host.getSnapshot().context.scope ||
					!host.getSnapshot().matches({ running: 'accepting' })
				) {
					message.port.close()
					return
				}
				const surface = remoteReaderSurface(message.port, message.fullscreen)
				const event = {
					type: 'ATTACH_BOUND',
					scope: message.scope,
					surface,
					documentId: message.documentId,
					sources: [
						...new Set(
							message.images.flatMap((value) => {
								try {
									const parsed = imageUrlSchema.safeParse(decodeURIComponent(value))
									return parsed.success ? [parsed.data] : []
								} catch {
									return []
								}
							})
						)
					]
				} satisfies Parameters<WorkerHost['send']>[0]
				if (!host.getSnapshot().can(event)) {
					surface.dispose()
					return
				}
				surfaces.add(surface)
				host.send(event)
			} else {
				host.send(message)
				if (message.type === 'LIBRARY' || message.type === 'TAG_FORM')
					self.postMessage({
						type: 'RECEIVED',
						requestId: message.requestId,
						scope: message.scope
					})
			}
		}
		return
	}
	const decoded = initialize.safeParse(data)
	if (!decoded.success) return
	const { serverUrl, storage: storagePort, broker: brokerPort } = decoded.data
	updateConnectivity = bindWorkerConnectivity(decoded.data.online ?? navigator.onLine)
	const storage = accountStorageClient(storagePort)
	const broker = brokerHostClient(brokerPort)
	const key = accountStorageKey(serverUrl)
	self.postMessage({ type: 'STORAGE_NAMESPACE', key })
	const input = accountInput({
		serverUrl,
		env: 'clipper',
		store: createWorkerAccountStore(key, storage),
		runtimeSources: { wasmUrl, wasmVersion: JAZZ_RUNTIME_VERSION, browserWorkerHost: broker }
	})
	const actor = createActor(workerHostMachine, {
		input: { ...input, scope: crypto.randomUUID() },
		inspect: inspectMachines
	})
	host = actor
	const publish = () => {
		if (actor.getSnapshot().matches('failed')) {
			self.postMessage({ type: 'FAILED' })
			return
		}
		const application = actor.getSnapshot().children.application
		const snapshot = application?.getSnapshot()
		const binding = selectRecoveryBinding(snapshot)
		if (binding?.capability !== observedRecovery) {
			observedRecovery = binding?.capability
			actor.send({ type: 'BIND_RECOVERY', binding })
			return
		}
		const recovery = actor.getSnapshot().context.recovery
		self.postMessage({
			type: 'RECOVERY',
			scope: actor.getSnapshot().context.scope,
			available: !!recovery,
			view: recoveryView(recovery)
		})
		const library = selectLibraryActor(snapshot)
		if (library !== observedLibrary) {
			observedLibrary = library
			actor.send({ type: 'BIND_LIBRARY', library, scope: crypto.randomUUID() })
			return
		}
		const watched: AnyActorRef[] = [
			application,
			library,
			actor.getSnapshot().context.tagForm,
			recovery,
			recovery?.getSnapshot().children.phrase,
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
		const readerContext = library?.getSnapshot().children.readerExperience?.getSnapshot().context
		for (const surface of surfaces) {
			if (
				readerContext?.attachment?.surface !== surface &&
				readerContext?.pendingAttachment?.surface !== surface &&
				readerContext?.display !== surface.fullscreen
			) {
				surface.dispose()
				surfaces.delete(surface)
			}
		}
		const projection = projectRuntime(actor.getSnapshot())
		const revision = projection.library
			? projection.library.scope + ':' + projection.library.readerRevision
			: ''
		if (projection.library && revision === sentReader) projection.library.reader = undefined
		sentReader = revision
		self.postMessage(projection)
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
