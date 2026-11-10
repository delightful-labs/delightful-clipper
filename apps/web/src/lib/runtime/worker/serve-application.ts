import { imageUrlSchema } from '../../images/schema.js'
import { bindWorkerConnectivity } from '../../offline/connectivity.js'
/// <reference lib="webworker" />
import { createActor } from 'xstate'

import { z } from 'zod'
import wasmUrl from '#jazz-wasm-binary?url'
import { accountInput } from '../../backend/jazz/account.js'
import { JAZZ_RUNTIME_VERSION } from '../../offline/runtime-version.js'
import { projectRuntime } from './views.js'
import { commandSchema } from './protocol.js'
import { recoveryView } from './recovery-owner.js'
import { inspectMachines } from '../../diagnostics/inspect.js'
import { workerHostMachine } from './host-machine.js'
import type { WorkerHost } from './host-machine.js'
import { createScopedWorkerAccountStore } from './scoped-account-store.js'
import { accountStorageKey } from './storage-channel.js'
import { createScopedAccountStorage } from './scoped-storage-channel.js'
import { hostScopeSchema } from './host-close-channel.js'
import { brokerHostClient } from './broker-channel.js'

export function serveApplicationWorker(options: {
	account: typeof accountInput
	storageKey?: typeof accountStorageKey
	attach?: (host: WorkerHost) => { publish: () => void; close: () => void }
}) {
	let updateConnectivity: ((online: boolean) => void) | undefined
	const initialize = z.object({
		online: z.boolean().optional(),
		callbackAttempt: z.string().max(256).nullable().optional(),
		type: z.literal('INITIALIZE'),
		appId: z.string().uuid(),
		serverUrl: z.string().url(),
		storage: z.instanceof(MessagePort),
		storageControl: z.instanceof(MessagePort),
		storageScope: hostScopeSchema,
		broker: z.instanceof(MessagePort),
		brokerControl: z.instanceof(MessagePort),
		brokerScope: hostScopeSchema
	})
	let host: WorkerHost | undefined
	let sentReader = ''

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
						message.port.postMessage({ type: 'DISPOSE', id: crypto.randomUUID() })
						message.port.close()
						return
					}
					const event = {
						type: 'ATTACH_BOUND',
						scope: message.scope,
						port: message.port,
						fullscreen: message.fullscreen,
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
		const storage = createScopedAccountStorage(
			storagePort,
			decoded.data.storageControl,
			decoded.data.storageScope,
			{
				onOverdue: () => self.postMessage({ type: 'FAILED' }),
				onBlocked: () => self.postMessage({ type: 'FAILED' })
			}
		)
		const broker = brokerHostClient(
			brokerPort,
			decoded.data.brokerControl,
			decoded.data.brokerScope,
			{
				onOverdue: () => self.postMessage({ type: 'FAILED' }),
				onBlocked: () => self.postMessage({ type: 'FAILED' })
			}
		)
		const key = (options.storageKey ?? accountStorageKey)(serverUrl)
		self.postMessage({ type: 'STORAGE_NAMESPACE', key })
		const accountStore = createScopedWorkerAccountStore(key, storage, {
			onOverdue: () => self.postMessage({ type: 'FAILED' })
		})
		const input = options.account({
			serverUrl,
			env: 'clipper',
			store: accountStore,
			runtimeSources: { wasmUrl, wasmVersion: JAZZ_RUNTIME_VERSION, browserWorkerHost: broker }
		})
		const actor = createActor(workerHostMachine, {
			input: {
				...input,
				scope: crypto.randomUUID(),
				closeAccountStore: accountStore.close,
				closeBroker: broker.close,
				callbackAttempt: decoded.data.callbackAttempt,
				authReturned: () => self.postMessage({ type: 'AUTH_RETURNED' })
			},
			inspect: inspectMachines
		})
		host = actor
		const attachment = options.attach?.(actor)
		const publish = () => {
			attachment?.publish()
			if (actor.getSnapshot().matches('failed') || actor.getSnapshot().context.closeIssue) {
				self.postMessage({ type: 'FAILED', issue: actor.getSnapshot().context.closeIssue })
				return
			}
			const recovery = actor.getSnapshot().context.recovery
			self.postMessage({
				type: 'RECOVERY',
				scope: actor.getSnapshot().context.scope,
				available: !!recovery,
				view: recoveryView(recovery)
			})
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
				attachment?.close()
				const url = actor.getSnapshot().context.redirect
				self.postMessage(url ? { type: 'NAVIGATE', url } : { type: 'CLOSED' })
			},
			error: () => self.postMessage({ type: 'FAILED' })
		})
		actor.start()
	}
}
