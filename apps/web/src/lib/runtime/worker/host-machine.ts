import { atprotoMachine } from '../../machines/runtime/atproto.js'
import type { EventPayload } from '../../machines/events.js'
import {
	types,
	createCallbackLogic,
	setup,
	createAsyncLogic,
	type ActorRefFrom,
	matchesState
} from 'xstate'
import { hasDetachedTransactions } from '../../backend/jazz/transaction.js'

import type { Session } from '../../backend/jazz/account.js'
import type { WorkerHostClosed } from 'delightful-local-first/worker/channel/contracts'
import type { SessionOwnerReply } from 'delightful-local-first/session/contracts'
import type { AccountInput, RecoveryBinding } from '../../contracts/account.js'
import { createApplicationReadinessMachine } from '../../machines/runtime/application-readiness.js'
import type { RuntimeCommand } from './protocol.js'
import { libraryMachine } from '../../machines/capture/library.js'
import { tagFormMachine } from '../../machines/capture/tag-form.js'
import type { ReaderSurface } from '../../reader/surface.js'
import { createRecoveryOwner } from './recovery-owner.js'
import type { RecoveryOwner } from './recovery-owner.js'
import { readerSurfaceLeaseMachine } from './surface-lease.js'
import {
	applicationBindingFacts,
	sameApplicationBinding,
	bindingObservation
} from './host-observation.js'
import type { ApplicationBindingFacts, libraryBindingFacts } from './host-observation.js'
import { REALM_CLOSE_POLICY } from './close-policy.js'
import type { WorkerCloseIssue } from './close-policy.js'
import { observeBrowserConnection } from '../../offline/browser.js'

function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Worker binding unavailable')
	return value
}
const application = createApplicationReadinessMachine<Session>(observeBrowserConnection)
type Input = AccountInput<Session> & {
	scope: string
	callbackAttempt?: string | null | undefined
	authReturned?: () => void
	closeAccountStore?: () => Promise<WorkerHostClosed>
	closeBroker?: () => Promise<WorkerHostClosed>
	closePolicy?: Partial<typeof REALM_CLOSE_POLICY>
}
type LibraryRef = ActorRefFrom<typeof libraryMachine>
type SurfaceSlot = {
	id: string
	child: ActorRefFrom<typeof readerSurfaceLeaseMachine>
	subscription: import('xstate').ActorRef<import('xstate').Snapshot<unknown>, never>
}
type Context = {
	pending: ApplicationBindingFacts
	activeBinding: ApplicationBindingFacts
	pendingScope: string | undefined
	bindingGeneration: number
	facts: ReturnType<typeof libraryBindingFacts> | undefined
	surfaces: SurfaceSlot[]
	surfaceSequence: number
	applicationClosed: boolean
	closeIssue: WorkerCloseIssue | undefined
	renderRevision: number
	oauthScope: string | undefined
	redirect: string | undefined
	recovery: RecoveryOwner | undefined
	input: Input
	session: Session | undefined
	library: LibraryRef | undefined
	scope: string
	limit: number
	tagArticleId: string
	tagForm: import('xstate').ActorFromLogic<typeof tagFormMachine> | undefined
}
type Event =
	| { type: 'APPLICATION_OBSERVED'; facts: ApplicationBindingFacts }
	| { type: 'LIBRARY_OBSERVED'; facts: ReturnType<typeof libraryBindingFacts>; generation: number }
	| { type: 'BINDING_IDENTIFIED'; scope: string; generation: number }
	| { type: 'SURFACE_CLOSED'; id: string }
	| { type: 'CLOSE_ISSUE'; issue: WorkerCloseIssue }
	| { type: 'RENDER' }
	| { type: 'BINDING_FAILED'; generation: number }
	| RuntimeCommand
	| { type: 'BIND_RECOVERY'; binding: RecoveryBinding | undefined }
	| { type: 'BIND_LIBRARY'; library: LibraryRef | undefined; scope: string }
	| {
			type: 'ATTACH_BOUND'
			scope: string
			documentId: string
			sources: string[]
			surface?: ReaderSurface
			port?: MessagePort
			fullscreen?: { supported: boolean; active: boolean }
	  }
	| { type: 'OAUTH_REDIRECT'; url: string }
	| { type: 'OAUTH_RETURNED' }
	| { type: 'SHUTDOWN' }
	| { type: 'OWNER_READY'; session: Session; custodyClear: boolean }
	| { type: 'OWNER_EMPTY'; custodyClear: boolean }
	| { type: 'APPLICATION_CLOSED'; clean: boolean }
const owner = createCallbackLogic<SessionOwnerReply<Session>, Input>(
	({ input, self, receive, sendBack }) => {
		const scope = { binding: input.startup.scope.binding, attachment: {}, generation: 0 }
		receive((event) => {
			if (event.type === 'ACQUIRED')
				sendBack({
					type: 'OWNER_READY',
					session: event.session,
					custodyClear: !hasDetachedTransactions()
				})
			else if (event.type === 'ACQUISITION_FAILED')
				sendBack({ type: 'OWNER_EMPTY', custodyClear: !hasDetachedTransactions() })
		})
		input.startup.owner.send({ type: 'ACQUIRE', scope, replyTo: self })
		return () => input.startup.owner.send({ type: 'RELEASE', scope, replyTo: self })
	}
)
const bindingIdentity = createCallbackLogic<
	never,
	{ scope: string | undefined; generation: number }
>(({ input, sendBack }) =>
	sendBack({
		type: 'BINDING_IDENTIFIED',
		scope: input.scope ?? crypto.randomUUID(),
		generation: input.generation
	})
)
const actors = {
	bindingIdentity,
	bindingObservation,
	surface: readerSurfaceLeaseMachine,
	oauth: atprotoMachine,
	application,
	owner,
	tagForm: tagFormMachine,
	close: createAsyncLogic({ run: ({ input }: { input: Session }) => input.close() }),
	closeTransport: createAsyncLogic<WorkerHostClosed, () => Promise<WorkerHostClosed>>({
		run: ({ input }) => input()
	})
}

/** Realm owner. Application detach drains domain work first; then wait for a
 * pending DLF acquisition and close its actual SDK session before releasing ports.
 * A failed drain never acknowledges safe worker termination. */
export const workerHostMachine = setup({
	schemas: {
		context: types<Context>(),
		output: types<{ outcome: 'closed'; redirect: string | undefined }>(),
		events: {
			SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
			ATPROTO: types<EventPayload<Event, 'ATPROTO'>>(),
			OAUTH_REDIRECT: types<EventPayload<Event, 'OAUTH_REDIRECT'>>(),
			OAUTH_RETURNED: types<EventPayload<Event, 'OAUTH_RETURNED'>>(),
			CONNECTIVITY: types<EventPayload<Event, 'CONNECTIVITY'>>(),
			RECOVERY: types<EventPayload<Event, 'RECOVERY'>>(),
			ACCOUNT: types<EventPayload<Event, 'ACCOUNT'>>(),
			LIBRARY: types<EventPayload<Event, 'LIBRARY'>>(),
			MORE: types<EventPayload<Event, 'MORE'>>(),
			TAG_EDIT: types<EventPayload<Event, 'TAG_EDIT'>>(),
			ATTACH: types<EventPayload<Event, 'ATTACH'>>(),
			TAG_FORM: types<EventPayload<Event, 'TAG_FORM'>>(),
			BIND_RECOVERY: types<EventPayload<Event, 'BIND_RECOVERY'>>(),
			BIND_LIBRARY: types<EventPayload<Event, 'BIND_LIBRARY'>>(),
			ATTACH_BOUND: types<EventPayload<Event, 'ATTACH_BOUND'>>(),
			OWNER_READY: types<EventPayload<Event, 'OWNER_READY'>>(),
			OWNER_EMPTY: types<EventPayload<Event, 'OWNER_EMPTY'>>(),
			LIBRARY_OBSERVED: types<EventPayload<Event, 'LIBRARY_OBSERVED'>>(),
			BINDING_IDENTIFIED: types<EventPayload<Event, 'BINDING_IDENTIFIED'>>(),
			SURFACE_CLOSED: types<EventPayload<Event, 'SURFACE_CLOSED'>>(),
			CLOSE_ISSUE: types<EventPayload<Event, 'CLOSE_ISSUE'>>(),
			RENDER: types(),
			BINDING_FAILED: types<EventPayload<Event, 'BINDING_FAILED'>>()
		},
		internalEvents: {
			APPLICATION_CLOSED: types<EventPayload<Event, 'APPLICATION_CLOSED'>>(),
			APPLICATION_OBSERVED: types<EventPayload<Event, 'APPLICATION_OBSERVED'>>()
		},
		input: types<Input>(),
		tags: types<string>(),
		children: {
			oauth: types<ActorRefFrom<typeof atprotoMachine>>(),
			application: types<import('xstate').ActorRefFrom<(typeof actors)['application']>>(),
			owner: types<import('xstate').ActorRefFrom<(typeof actors)['owner']>>(),
			tagForm: types<import('xstate').ActorRefFrom<(typeof actors)['tagForm']>>(),
			closeAccountStore: types<import('xstate').ActorRefFrom<typeof actors.closeTransport>>(),
			closeBroker: types<import('xstate').ActorRefFrom<typeof actors.closeTransport>>(),
			bindingIdentity: types<ActorRefFrom<typeof bindingIdentity>>(),
			bindingObservation: types<ActorRefFrom<typeof bindingObservation>>(),
			close: types<import('xstate').ActorRefFrom<(typeof actors)['close']>>()
		}
	},
	actors,
	delays: {
		drainDeadline: ({ context }) =>
			context.input.closePolicy?.drainMs ?? REALM_CLOSE_POLICY.drainMs,
		acquisitionDeadline: ({ context }) =>
			context.input.closePolicy?.acquisitionMs ?? REALM_CLOSE_POLICY.acquisitionMs,
		sessionCloseDeadline: ({ context }) =>
			context.input.closePolicy?.sessionCloseMs ?? REALM_CLOSE_POLICY.sessionCloseMs,
		attachmentDeadline: ({ context }) =>
			context.input.closePolicy?.surfaceMs ?? REALM_CLOSE_POLICY.surfaceMs
	},
	guards: {
		hasBroker: ({ context }: { context: Context }) => context.input.closeBroker !== undefined,
		hasAccountStore: ({ context }: { context: Context }) =>
			context.input.closeAccountStore !== undefined,
		custodyClear: ({ event }: { event: Event }) =>
			(event.type === 'OWNER_READY' || event.type === 'OWNER_EMPTY') && event.custodyClear,
		suppliedRecovery: ({ event }: { event: Event }) =>
			event.type === 'BIND_RECOVERY' && !!event.binding,
		currentRecovery: ({ context, event }: { context: Context; event: Event }) =>
			event.type === 'RECOVERY' && event.scope === context.scope && !!context.recovery,
		suppliedLibrary: ({ event }: { event: Event }) =>
			event.type === 'BIND_LIBRARY' && !!event.library,
		resettingTags: ({ context, event }: { context: Context; event: Event }) =>
			event.type === 'TAG_FORM' &&
			event.event.type === 'RESET' &&
			event.scope === context.scope &&
			!!context.tagForm,
		currentAccount: ({
			context,
			event,
			value
		}: {
			context: Context
			event: Event
			value: import('xstate').StateValue
		}) =>
			'scope' in event &&
			event.scope === context.scope &&
			!matchesState({ running: { accepting: 'retiring' } }, value) &&
			!matchesState({ running: { accepting: 'identifying' } }, value),
		currentReader: ({ context, event }: { context: Context; event: Event }) =>
			event.type === 'ATTACH_BOUND' &&
			event.scope === context.scope &&
			context.facts?.active === true &&
			context.facts.documentId === event.documentId,
		currentLibrary: ({ context, event }: { context: Context; event: Event }) =>
			'scope' in event &&
			event.scope === context.scope &&
			!!context.library &&
			context.facts?.active === true,
		applicationDrained: ({ event }: { event: Event }) =>
			event.type === 'APPLICATION_CLOSED' && event.clean
	}
}).createMachine({
	id: 'worker-host',
	initial: 'running',
	context: ({ input }) => ({
		pending: { library: undefined, recovery: undefined },
		activeBinding: { library: undefined, recovery: undefined },
		pendingScope: undefined,
		bindingGeneration: 0,
		facts: undefined,
		surfaces: [],
		surfaceSequence: 0,
		applicationClosed: false,
		closeIssue: undefined,
		renderRevision: 0,
		oauthScope: undefined,
		redirect: undefined,
		input,
		recovery: undefined,
		session: undefined,
		library: undefined,
		scope: input.scope,
		limit: 50,
		tagForm: undefined,
		tagArticleId: ''
	}),
	output: ({ context }) => ({ outcome: 'closed', redirect: context.redirect }),
	on: {
		RENDER: ({ context }) => ({ context: { renderRevision: context.renderRevision + 1 } }),
		CLOSE_ISSUE: ({ context, event }) => ({
			context: {
				closeIssue: context.closeIssue?.reason === 'failed' ? context.closeIssue : event.issue
			}
		}),
		SURFACE_CLOSED: ({ context, event }, enq) => {
			const slot = context.surfaces.find((slot) => slot.id === event.id)
			if (!slot) return
			enq.stop(slot.subscription)
			enq.stop(slot.child)
			return { context: { surfaces: context.surfaces.filter((candidate) => candidate !== slot) } }
		}
	},
	states: {
		running: {
			initial: 'accepting',
			on: {
				APPLICATION_CLOSED: (args) => {
					if (args.guards.applicationDrained(args)) {
						return { target: '.draining', context: { applicationClosed: true } }
					}
					return {
						target: 'failed',
						context: { closeIssue: { stage: 'application', reason: 'failed' } }
					}
				}
			},
			invoke: [
				{
					id: 'oauth',
					src: 'oauth',
					onSnapshot: ({ context }) => ({
						context: { renderRevision: context.renderRevision + 1 }
					}),
					input: ({ context }) => ({ callbackAttempt: context.input.callbackAttempt })
				},
				{
					id: 'application',
					src: 'application',
					onSnapshot: ({ event }, enq) =>
						enq.raise({
							type: 'APPLICATION_OBSERVED',
							facts: applicationBindingFacts(event.snapshot)
						}),
					input: ({ context }: { context: Context }) => context.input,
					onDone: (args, enq) => {
						enq.raise({
							type: 'APPLICATION_CLOSED',
							clean: args.event.output.clean
						})
					},
					onError: {
						target: 'failed',
						context: { closeIssue: { stage: 'application', reason: 'failed' } }
					}
				}
			],
			states: {
				accepting: {
					initial: 'unbound',
					states: {
						unbound: {},
						retiring: {
							initial: 'waiting',
							entry: ({ context }, enq) => {
								enq.stop(context.tagForm)
								enq.stop(context.recovery)
								for (const slot of context.surfaces) enq.sendTo(slot.child, { type: 'SHUTDOWN' })
								return {
									context: {
										library: undefined,
										facts: undefined,
										tagForm: undefined,
										recovery: undefined,
										tagArticleId: ''
									}
								}
							},
							always: ({ context }) =>
								context.surfaces.length === 0 ? { target: 'identifying' } : undefined,
							states: {
								waiting: { timeout: 'attachmentDeadline', onTimeout: { target: 'overdue' } },
								overdue: {
									entry: ({ context }) => ({
										context: {
											closeIssue: context.closeIssue ?? { stage: 'attachments', reason: 'overdue' }
										}
									})
								}
							}
						},
						identifying: {
							invoke: {
								id: 'bindingIdentity',
								src: 'bindingIdentity',
								input: ({ context }) => ({
									scope: context.pendingScope,
									generation: context.bindingGeneration
								})
							},
							on: {
								BINDING_IDENTIFIED: ({ context, event }, enq) => {
									if (event.generation !== context.bindingGeneration) return
									const library = context.pending.library
									const recovery = context.pending.recovery
										? enq.spawn(createRecoveryOwner(context.pending.recovery), { input: undefined })
										: undefined
									const tagForm = library ? enq.spawn('tagForm', { input: { library } }) : undefined
									return {
										target: 'bound',
										context: {
											activeBinding: context.pending,
											library,
											recovery,
											tagForm,
											scope: event.scope,
											limit: 50,
											facts: undefined
										}
									}
								}
							}
						},
						bound: {
							invoke: {
								id: 'bindingObservation',
								src: 'bindingObservation',
								input: ({ context }) => ({
									library: context.library,
									tagForm: context.tagForm,
									recovery: context.recovery,
									generation: context.bindingGeneration
								})
							}
						}
					},
					on: {
						ATPROTO: (args, enq) => {
							if (!args.guards.currentAccount(args)) return
							enq.sendTo('oauth', { type: 'BEGIN', handle: args.event.handle })
							return { context: { oauthScope: args.context.scope } }
						},
						OAUTH_RETURNED: ({ context }, enq) => {
							enq(() => context.input.authReturned?.())
						},
						OAUTH_REDIRECT: ({ context, event, value }, enq) => {
							if (
								context.oauthScope !== context.scope ||
								matchesState({ running: { accepting: 'retiring' } }, value) ||
								matchesState({ running: { accepting: 'identifying' } }, value)
							)
								return
							enq.sendTo('application', { type: 'SHUTDOWN' })
							return { target: 'draining', context: { redirect: event.url } }
						},

						APPLICATION_OBSERVED: ({ context, event, value }) => {
							if (
								sameApplicationBinding(context.activeBinding, event.facts) &&
								!matchesState({ running: { accepting: 'retiring' } }, value) &&
								!matchesState({ running: { accepting: 'identifying' } }, value)
							)
								return { context: { renderRevision: context.renderRevision + 1 } }
							if (
								matchesState({ running: { accepting: 'retiring' } }, value) ||
								matchesState({ running: { accepting: 'identifying' } }, value)
							)
								return { context: { pending: event.facts } }
							return {
								target: '.retiring',
								context: {
									pending: event.facts,
									pendingScope: undefined,
									bindingGeneration: context.bindingGeneration + 1
								}
							}
						},
						BIND_RECOVERY: ({ context, event }) => ({
							target: '.retiring',
							context: {
								pending: { library: context.library, recovery: event.binding },
								pendingScope: undefined,
								bindingGeneration: context.bindingGeneration + 1
							}
						}),
						RECOVERY: (args, enq) => {
							if (!args.guards.currentRecovery(args)) return
							enq.sendTo(
								required(args.context.recovery),
								(({ event }) => {
									if (event.type !== 'RECOVERY') throw new Error('Recovery intent unavailable')
									return event.event
								})(args)
							)
						},
						BIND_LIBRARY: ({ context, event }) => ({
							target: '.retiring',
							context: {
								pending: { library: event.library, recovery: context.activeBinding.recovery },
								pendingScope: event.scope,
								bindingGeneration: context.bindingGeneration + 1
							}
						}),
						LIBRARY_OBSERVED: ({ context, event }) =>
							event.generation === context.bindingGeneration &&
							event.facts.library === context.library
								? { context: { facts: event.facts, renderRevision: context.renderRevision + 1 } }
								: undefined,
						BINDING_FAILED: ({ context, event }) =>
							event.generation === context.bindingGeneration
								? { target: '#worker-host.failed' }
								: undefined,
						LIBRARY: (args, enq) => {
							if (!args.guards.currentLibrary(args)) return
							const { context, event } = args
							enq.sendTo(
								required(context.library),
								(({ event }) => {
									if (event.type !== 'LIBRARY') throw new Error('Library intent unavailable')
									return event.event
								})(args)
							)
							return {
								context: ['QUERY', 'FILTER', 'TAG_FILTER'].includes(event.event.type)
									? { limit: 50 }
									: { limit: context.limit }
							}
						},
						TAG_EDIT: (args) => {
							if (!args.guards.currentLibrary(args)) return
							return { context: { tagArticleId: args.event.id ?? '' } }
						},
						MORE: (args) => {
							if (!args.guards.currentLibrary(args)) return
							return { context: { limit: args.context.limit + 50 } }
						},
						ATTACH_BOUND: (args, enq) => {
							const { context, event, self } = args
							if (!event.port || !event.fullscreen) return
							const child = enq.spawn('surface', {
								input: {
									id: `${context.bindingGeneration}:${context.surfaceSequence + 1}`,
									port: event.port,
									fullscreen: event.fullscreen,
									library: args.guards.currentReader(args) ? context.library : undefined,
									documentId: event.documentId,
									sources: event.sources,
									deadlineMs: context.input.closePolicy?.surfaceMs ?? REALM_CLOSE_POLICY.surfaceMs,
									onBlocked: () =>
										self.send({
											type: 'CLOSE_ISSUE',
											issue: { stage: 'reader', reason: 'failed' }
										}),
									onOverdue: () =>
										self.send({
											type: 'CLOSE_ISSUE',
											issue: { stage: 'reader', reason: 'overdue' }
										})
								}
							})
							const id = `${context.bindingGeneration}:${context.surfaceSequence + 1}`
							const subscription = enq.subscribeTo(child, {
								done: (): Event => ({ type: 'SURFACE_CLOSED', id }),
								error: (): Event => ({
									type: 'CLOSE_ISSUE',
									issue: { stage: 'reader', reason: 'failed' }
								})
							})
							return {
								context: {
									surfaceSequence: context.surfaceSequence + 1,
									surfaces: [...context.surfaces, { id, child, subscription }]
								}
							}
						},
						TAG_FORM: (args, enq) => {
							const { context } = args
							if (args.guards.resettingTags(args)) {
								enq.sendTo(required(context.tagForm), { type: 'RESET' })
								return {}
							}
							if (args.guards.currentLibrary(args)) {
								enq.sendTo(
									required(context.tagForm),
									(({ context, event }) => {
										if (event.type !== 'TAG_FORM' || event.event.type !== 'SELECT')
											throw new Error('Tag selection unavailable')
										const intent = event.event
										const tags = context.facts?.tags[intent.id]
										return {
											...intent,
											previous: tags ?? [],
											enabled: tags !== undefined && context.facts?.active === true
										}
									})(args)
								)
								return {}
							}
						},
						ACCOUNT: (args, enq) => {
							if (!args.guards.currentAccount(args)) return
							enq.sendTo('application', args.event.event)
						},
						SHUTDOWN: (args, enq) => {
							enq.sendTo('application', { type: 'SHUTDOWN' })
							return { target: 'draining' }
						}
					}
				},
				draining: {
					initial: 'waiting',
					entry: ({ context }, enq) => {
						enq.stop(context.recovery)
						enq.stop(context.tagForm)
						for (const slot of context.surfaces) enq.sendTo(slot.child, { type: 'SHUTDOWN' })
						return {
							context: {
								library: undefined,
								facts: undefined,
								recovery: undefined,
								tagForm: undefined
							}
						}
					},
					always: ({ context }) =>
						context.applicationClosed && context.surfaces.length === 0
							? { target: '#worker-host.settlingAcquisition' }
							: undefined,
					states: {
						waiting: { timeout: 'drainDeadline', onTimeout: { target: 'overdue' } },
						overdue: {
							entry: ({ context }) => ({
								context: {
									closeIssue: context.closeIssue ?? { stage: 'application', reason: 'overdue' }
								}
							})
						}
					}
				}
			}
		},
		settlingAcquisition: {
			initial: 'waiting',
			states: {
				waiting: { timeout: 'acquisitionDeadline', onTimeout: { target: 'overdue' } },
				overdue: {
					entry: ({ context }) => ({
						context: {
							closeIssue: context.closeIssue ?? { stage: 'acquisition', reason: 'overdue' }
						}
					})
				}
			},
			invoke: {
				id: 'owner',
				src: 'owner',
				input: ({ context }: { context: Context }) => context.input
			},
			on: {
				OWNER_READY: (args) => {
					if (args.guards.custodyClear(args)) {
						return { target: 'closingSession', context: { session: args.event.session } }
					}
					return { target: 'failed' }
				},
				OWNER_EMPTY: (args) => {
					if (args.guards.custodyClear(args)) {
						return {
							target: args.guards.hasAccountStore(args)
								? 'closingAccountStore'
								: args.guards.hasBroker(args)
									? 'closingBroker'
									: 'closed'
						}
					}
					return { target: 'failed' }
				}
			}
		},
		closingSession: {
			initial: 'waiting',
			states: {
				waiting: { timeout: 'sessionCloseDeadline', onTimeout: { target: 'overdue' } },
				overdue: {
					entry: ({ context }) => ({
						context: { closeIssue: context.closeIssue ?? { stage: 'session', reason: 'overdue' } }
					})
				}
			},
			invoke: {
				id: 'close',
				src: 'close',
				input: ({ context }: { context: Context }) => {
					if (!context.session) throw new Error('Worker session unavailable')
					return context.session
				},
				onDone: (args) => ({
					target: args.guards.hasAccountStore(args)
						? 'closingAccountStore'
						: args.guards.hasBroker(args)
							? 'closingBroker'
							: 'closed'
				}),
				onError: {
					target: 'failed',
					context: { closeIssue: { stage: 'session', reason: 'failed' } }
				}
			}
		},
		closingAccountStore: {
			invoke: {
				id: 'closeAccountStore',
				src: 'closeTransport',
				input: ({ context }) => required(context.input.closeAccountStore),
				onDone: (args) => ({ target: args.guards.hasBroker(args) ? 'closingBroker' : 'closed' }),
				onError: {
					target: 'failed',
					context: { closeIssue: { stage: 'account-store', reason: 'failed' } }
				}
			}
		},
		closingBroker: {
			invoke: {
				id: 'closeBroker',
				src: 'closeTransport',
				input: ({ context }) => required(context.input.closeBroker),
				onDone: { target: 'closed' },
				onError: {
					target: 'failed',
					context: { closeIssue: { stage: 'broker', reason: 'failed' } }
				}
			}
		},

		closed: {
			type: 'final',
			entry: (args, enq) => {
				enq(({ context }) => context.input.startup.owner.stop(), args)
				return { context: { session: undefined } }
			}
		},
		failed: {}
	}
})
export type WorkerHost = ActorRefFrom<typeof workerHostMachine>
