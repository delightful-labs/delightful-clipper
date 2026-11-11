import { REALM_CLOSE_POLICY } from './close-policy.js'
import type { WorkerCloseIssue } from './close-policy.js'
import type { SimulatedClock } from 'xstate'
import type { EventPayload } from '../../machines/events.js'
import { types, createActor, createCallbackLogic, setup } from 'xstate'

import { serveBrokerHost } from './broker-channel.js'
import { isAccountStorageKey } from './storage-channel.js'
import { createScopedStorageHost } from './scoped-storage-channel.js'
import { serveReaderSurface } from '../../reader/surface-host.js'
import type { RuntimeCommand, LibraryIntent } from './protocol.js'
import type { RuntimeView, LibraryRender } from './views.js'
import type { RecoveryPhraseView } from 'delightful-local-first/recovery/contracts'
import type { ViewportElements } from '../../reader/viewport.js'

export type WorkerReply =
	| { type: 'NAVIGATE'; url: string }
	| { type: 'AUTH_RETURNED' }
	| { type: 'RECEIVED'; requestId: string; scope: string }
	| RuntimeView
	| { type: 'CLOSED' }
	| { type: 'FAILED'; issue?: WorkerCloseIssue }
	| { type: 'STORAGE_NAMESPACE'; key: string }
	| { type: 'RECOVERY'; scope: string; view: RecoveryPhraseView; available: boolean }
export type Input = {
	createWorker?: () => { worker: Worker; release: () => void }
	appId: string
	serverUrl: string
	publish: (view: RuntimeView) => void
	recovery: (view: RecoveryPhraseView, available: boolean, scope: string) => void
	failed: (issue?: WorkerCloseIssue) => void
	closeTimeoutMs?: number
	clock?: Pick<SimulatedClock, 'setTimeout' | 'clearTimeout'>
}
type Event =
	| { type: 'SEND'; message: RuntimeCommand; transfers?: Transferable[] }
	| { type: 'RECEIVED'; requestId: string }
	| { type: 'VIEW'; view: RuntimeView }
	| { type: 'UI_DETACHED' }
	| { type: 'SHUTDOWN' | 'CLOSED' }
	| { type: 'FAILED'; issue?: WorkerCloseIssue }
const resource = createCallbackLogic<Event, Input>(({ input, receive, sendBack }) => {
	const native = input.createWorker?.()
	const worker =
		native?.worker ??
		new Worker(new URL('./application.worker.ts', import.meta.url), { type: 'module' })
	const storage = new MessageChannel(),
		storageControl = new MessageChannel(),
		broker = new MessageChannel(),
		brokerControl = new MessageChannel()
	const storageScope = crypto.randomUUID()
	const brokerScope = crypto.randomUUID()
	const releaseBroker = serveBrokerHost(broker.port1, brokerControl.port1, brokerScope, {
		origin: window.location.origin,
		storage: {
			getItem: (key) => localStorage.getItem(key),
			setItem: (key, value) => localStorage.setItem(key, value)
		},
		open: (url, name) => new SharedWorker(url, { type: 'module', name })
	})
	const connectivity = () => worker.postMessage({ type: 'CONNECTIVITY', online: navigator.onLine })
	window.addEventListener('online', connectivity)
	window.addEventListener('offline', connectivity)
	const storageHost = createScopedStorageHost(storage.port1, storageControl.port1, storageScope, {
		getItem: (key) => localStorage.getItem(key),
		setItem: (key, value) => localStorage.setItem(key, value)
	})
	let recoveryAttached = true
	worker.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
		switch (data.type) {
			case 'STORAGE_NAMESPACE':
				if (isAccountStorageKey(data.key)) storageHost.bind(data.key)
				break
			case 'RECEIVED':
				sendBack({ type: 'RECEIVED', requestId: data.requestId })
				break
			case 'VIEW':
				sendBack({ type: 'VIEW', view: data })
				break
			case 'RECOVERY':
				if (recoveryAttached) input.recovery(data.view, data.available, data.scope)
				break
			case 'AUTH_RETURNED': {
				const url = new URL(window.location.href)
				url.searchParams.delete('atproto_attempt')
				window.history.replaceState(window.history.state, '', url)
				break
			}
			case 'NAVIGATE':
				window.location.assign(data.url)
				sendBack({ type: 'CLOSED' })
				break
			case 'CLOSED':
				sendBack({ type: 'CLOSED' })
				break
			case 'FAILED':
				sendBack({ type: 'FAILED', ...(data.issue ? { issue: data.issue } : {}) })
		}
	}
	worker.onerror = () => sendBack({ type: 'FAILED' })
	worker.onmessageerror = () => sendBack({ type: 'FAILED' })
	receive((event) => {
		if (event.type === 'SEND') worker.postMessage(event.message, event.transfers ?? [])
		if (event.type === 'UI_DETACHED') recoveryAttached = false
		if (event.type === 'SHUTDOWN') {
			recoveryAttached = false
			worker.postMessage({ type: 'SHUTDOWN' })
		}
	})
	worker.postMessage(
		{
			type: 'INITIALIZE',
			callbackAttempt: new URL(window.location.href).searchParams.get('atproto_attempt'),
			online: navigator.onLine,
			appId: input.appId,
			serverUrl: input.serverUrl,
			storage: storage.port2,
			storageControl: storageControl.port2,
			storageScope,
			broker: broker.port2,
			brokerControl: brokerControl.port2,
			brokerScope
		},
		[storage.port2, storageControl.port2, broker.port2, brokerControl.port2]
	)
	return () => {
		window.removeEventListener('online', connectivity)
		window.removeEventListener('offline', connectivity)
		worker.onmessage = null
		worker.onerror = null
		worker.onmessageerror = null
		storageHost.dispose()
		storage.port1.close()
		storageControl.port1.close()
		releaseBroker()
		worker.terminate()
		native?.release()
	}
})
/** UI-native transport lifetime only. It never retries commands or terminates a
 * worker before the domain owner acknowledges that all issued work has drained. */
type ClientContext = Input & { pending: string[] }
const clientMachine = setup({
	schemas: {
		context: types<ClientContext>(),
		events: {
			SEND: types<EventPayload<Event, 'SEND'>>(),
			RECEIVED: types<EventPayload<Event, 'RECEIVED'>>(),
			VIEW: types<EventPayload<Event, 'VIEW'>>(),
			UI_DETACHED: types<EventPayload<Event, 'UI_DETACHED'>>(),
			SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
			CLOSED: types<EventPayload<Event, 'CLOSED'>>(),
			FAILED: types<EventPayload<Event, 'FAILED'>>()
		},
		input: types<Input>(),
		tags: types<string>(),
		children: { resource: types<import('xstate').ActorRefFrom<typeof resource>>() }
	},
	actors: { resource }
}).createMachine({
	id: 'application-ui-port',
	initial: 'attached',
	context: ({ input }) => ({ ...input, pending: [] }),
	invoke: {
		id: 'resource',
		src: 'resource',
		input: ({ context }: { context: ClientContext }) => context
	},
	states: {
		attached: {
			on: {
				CLOSED: { target: 'closed' },
				VIEW: (args, enq) => {
					enq(() => args.context.publish(args.event.view))
				},
				SEND: (args, enq) => {
					const { event } = args
					enq.sendTo('resource', event)
					return {
						context: (({ context, event }) => {
							const message = event.message
							const waiting =
								(message.type === 'LIBRARY' && message.event.type === 'ORGANIZE') ||
								(message.type === 'TAG_FORM' && message.event.type === 'SELECT')
							return {
								pending:
									waiting && 'requestId' in message
										? [...context.pending, message.requestId]
										: context.pending
							}
						})(args)
					}
				},
				RECEIVED: (args) => {
					return {
						context: { pending: args.context.pending.filter((id) => id !== args.event.requestId) }
					}
				},
				SHUTDOWN: (args, enq) => {
					enq.sendTo('resource', { type: 'SHUTDOWN' })
					return { target: 'draining' }
				},
				FAILED: (args, enq) => {
					enq(() => args.context.failed(args.event.issue))
					return { target: 'failed' }
				}
			}
		},
		draining: {
			timeout: ({ context }) => context.closeTimeoutMs ?? REALM_CLOSE_POLICY.clientMs,
			onTimeout: ({ context }, enq) => {
				enq(() => context.failed({ stage: 'realm', reason: 'overdue' }))
				return { target: 'failed' }
			},
			on: {
				CLOSED: { target: 'closed' },
				FAILED: (args, enq) => {
					enq(() => args.context.failed(args.event.issue))
					return { target: 'failed' }
				}
			}
		},
		failed: {
			entry: (args, enq) => {
				enq.sendTo('resource', { type: 'UI_DETACHED' })
			},
			on: {
				CLOSED: { target: 'closed' },
				SHUTDOWN: (args, enq) => {
					enq.sendTo('resource', { type: 'SHUTDOWN' })
					return { target: 'draining' }
				}
			}
		},
		closed: { type: 'final' }
	}
})
export type LibraryClient = {
	getView: () => LibraryRender
	subscribe: (changed: (view: LibraryRender) => void) => { unsubscribe: () => void }
	send: (intent: LibraryIntent) => void
	more: () => void
	editTags: (id: string | undefined) => void
	tags: (event: { type: 'RESET' } | { type: 'SELECT'; id: string; names: string[] }) => void
	attach: (elements: ViewportElements, documentId: string) => () => void
}
export function openApplicationClient(input: Input) {
	const actor = createActor(clientMachine, {
		input,
		...(input.clock ? { clock: input.clock } : {})
	}).start()
	const post = (message: RuntimeCommand, transfers?: Transferable[]) => {
		if (actor.getSnapshot().status === 'active')
			actor.send({ type: 'SEND', message, ...(transfers ? { transfers } : {}) })
	}
	return {
		post,
		library: (initial: LibraryRender) => {
			let view = initial
			const observers = new Set<(view: LibraryRender) => void>()
			const scope = initial.scope
			const presentation = () =>
				actor.getSnapshot().context.pending.length
					? { ...view, view: { ...view.view, canOrganize: false } }
					: view
			const render = () => {
				const current = presentation()
				for (const observe of observers) observe(current)
			}
			let portObservation: { unsubscribe: () => void } | undefined
			const client: LibraryClient = {
				getView: () => presentation(),
				subscribe: (changed) => {
					observers.add(changed)
					portObservation ??= actor.subscribe(render)
					changed(presentation())
					return {
						unsubscribe: () => {
							observers.delete(changed)
							if (!observers.size) {
								portObservation?.unsubscribe()
								portObservation = undefined
							}
						}
					}
				},
				send: (event) => post({ type: 'LIBRARY', scope, requestId: crypto.randomUUID(), event }),
				more: () => post({ type: 'MORE', scope }),
				editTags: (id) => post({ type: 'TAG_EDIT', scope, ...(id ? { id } : {}) }),
				tags: (event) => post({ type: 'TAG_FORM', scope, requestId: crypto.randomUUID(), event }),
				attach: (elements, documentId) => {
					if (!actor.getSnapshot().matches('attached')) return () => {}
					const channel = new MessageChannel()
					const surface = serveReaderSurface(channel.port1, elements)
					post(
						{
							type: 'ATTACH',
							scope,
							documentId,
							images: Array.from(
								elements.root.querySelectorAll('img[data-clipper-image]'),
								(image) => image.getAttribute('data-clipper-image') ?? ''
							),
							port: channel.port2,
							fullscreen: surface.fullscreen
						},
						[channel.port2]
					)
					return surface.detach
				}
			}
			return {
				client,
				update: (next: LibraryRender) => {
					view = {
						...next,
						reader: next.readerRevision === view.readerRevision ? view.reader : next.reader
					}
					render()
				}
			}
		},
		close: () => actor.send({ type: 'SHUTDOWN' })
	}
}
