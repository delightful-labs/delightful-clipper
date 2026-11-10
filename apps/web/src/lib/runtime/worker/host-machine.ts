import { atprotoMachine } from '../../machines/runtime/atproto.js'
import type { EventPayload } from '../../machines/events.js'
import { types, createCallbackLogic, setup, createAsyncLogic, type ActorRefFrom } from 'xstate'
import { hasDetachedTransactions } from '../../backend/jazz/transaction.js'

import type { Session } from '../../backend/jazz/account.js'
import type { WorkerHostClosed } from 'delightful-local-first/worker/channel/contracts'
import type { SessionOwnerReply } from 'delightful-local-first/session/contracts'
import type { AccountInput, RecoveryBinding } from '../../contracts/account.js'
import { createApplicationReadinessMachine } from '../../machines/runtime/application-readiness.js'
import type { LibraryEvent } from '../../contracts/library.js'
import type { RuntimeCommand } from './protocol.js'
import { libraryMachine } from '../../machines/capture/library.js'
import { tagFormMachine } from '../../machines/capture/tag-form.js'
import type { ReaderSurface } from '../../reader/surface.js'
import { createRecoveryOwner } from './recovery-owner.js'
import type { RecoveryOwner } from './recovery-owner.js'
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
}
type LibraryRef = ActorRefFrom<typeof libraryMachine>
type Context = {
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
	| RuntimeCommand
	| { type: 'BIND_RECOVERY'; binding: RecoveryBinding | undefined }
	| { type: 'BIND_LIBRARY'; library: LibraryRef | undefined; scope: string }
	| {
			type: 'ATTACH_BOUND'
			scope: string
			documentId: string
			sources: string[]
			surface: ReaderSurface
	  }
	| { type: 'OAUTH_REDIRECT'; url: string }
	| { type: 'OAUTH_RETURNED' }
	| { type: 'SHUTDOWN' }
	| { type: 'OWNER_READY'; session: Session }
	| { type: 'OWNER_EMPTY' }
	| { type: 'APPLICATION_CLOSED'; clean: boolean }
const owner = createCallbackLogic<SessionOwnerReply<Session>, Input>(
	({ input, self, receive, sendBack }) => {
		const scope = { binding: input.startup.scope.binding, attachment: {}, generation: 0 }
		receive((event) => {
			if (event.type === 'ACQUIRED') sendBack({ type: 'OWNER_READY', session: event.session })
			else if (event.type === 'ACQUISITION_FAILED') sendBack({ type: 'OWNER_EMPTY' })
		})
		input.startup.owner.send({ type: 'ACQUIRE', scope, replyTo: self })
		return () => input.startup.owner.send({ type: 'RELEASE', scope, replyTo: self })
	}
)
const actors = {
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
			APPLICATION_CLOSED: types<EventPayload<Event, 'APPLICATION_CLOSED'>>()
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
			close: types<import('xstate').ActorRefFrom<(typeof actors)['close']>>()
		}
	},
	actors,
	guards: {
		hasBroker: ({ context }: { context: Context }) => context.input.closeBroker !== undefined,
		hasAccountStore: ({ context }: { context: Context }) =>
			context.input.closeAccountStore !== undefined,
		custodyClear: () => !hasDetachedTransactions(),
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
		currentAccount: ({ context, event }: { context: Context; event: Event }) =>
			'scope' in event && event.scope === context.scope,
		currentReader: ({ context, event }: { context: Context; event: Event }) => {
			const reader = context.library?.getSnapshot().context.reader
			return (
				event.type === 'ATTACH_BOUND' &&
				event.scope === context.scope &&
				reader?.kind === 'available' &&
				reader.document.snapshotId === event.documentId
			)
		},
		currentLibrary: ({ context, event }: { context: Context; event: Event }) =>
			'scope' in event &&
			event.scope === context.scope &&
			!!context.library?.getSnapshot().context.capability?.isCurrent() &&
			context.library.getSnapshot().matches({ running: { control: 'active' } }),
		applicationDrained: ({ event }: { event: Event }) =>
			event.type === 'APPLICATION_CLOSED' && event.clean
	},
	actions: {
		bindRecovery: ({
			event,
			spawn
		}: {
			event: Event
			spawn: import('xstate').EnqueueObject<
				Event,
				never,
				import('xstate').SystemRegistry,
				typeof actors
			>['spawn']
		}) => {
			if (event.type !== 'BIND_RECOVERY') throw new Error('Recovery binding unavailable')
			return {
				context: {
					recovery: spawn(createRecoveryOwner(required(event.binding)), { input: undefined })
				}
			}
		},

		bindLibrary: ({
			event,
			spawnTagForm
		}: {
			event: Event
			spawnTagForm: (library: LibraryRef) => import('xstate').ActorFromLogic<typeof tagFormMachine>
		}) => {
			if (event.type !== 'BIND_LIBRARY') throw new Error('Library binding unavailable')
			const library = required(event.library)
			return {
				context: {
					tagArticleId: '',
					library,
					scope: event.scope,
					limit: 50,
					tagForm: spawnTagForm(library)
				}
			}
		}
	}
}).createMachine({
	id: 'worker-host',
	initial: 'running',
	context: ({ input }) => ({
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
	states: {
		running: {
			initial: 'accepting',
			on: {
				APPLICATION_CLOSED: (args) => {
					if (args.guards.applicationDrained(args)) {
						return { target: 'settlingAcquisition' }
					}
					return { target: 'failed' }
				}
			},
			invoke: [
				{
					id: 'oauth',
					src: 'oauth',
					input: ({ context }) => ({ callbackAttempt: context.input.callbackAttempt })
				},
				{
					id: 'application',
					src: 'application',
					input: ({ context }: { context: Context }) => context.input,
					onDone: (args, enq) => {
						enq.raise({
							type: 'APPLICATION_CLOSED',
							clean: args.event.output.clean
						})
					},
					onError: { target: 'failed' }
				}
			],
			states: {
				accepting: {
					on: {
						ATPROTO: (args, enq) => {
							if (!args.guards.currentAccount(args)) return
							enq.sendTo('oauth', { type: 'BEGIN', handle: args.event.handle })
						},
						OAUTH_RETURNED: ({ context }, enq) => {
							enq(() => context.input.authReturned?.())
						},
						OAUTH_REDIRECT: ({ event }, enq) => {
							enq.sendTo('application', { type: 'SHUTDOWN' })
							return { target: 'draining', context: { redirect: event.url } }
						},

						BIND_RECOVERY: (args, enq) => {
							const { context } = args
							if (args.guards.suppliedRecovery(args)) {
								enq.stop(context.recovery)
								return { context: args.actions.bindRecovery({ ...args, spawn: enq.spawn }).context }
							}
							enq.stop(context.recovery)
							return { context: { recovery: undefined } }
						},
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
						BIND_LIBRARY: (args, enq) => {
							const { context } = args
							if (args.guards.suppliedLibrary(args)) {
								enq.stop(context.tagForm)
								return {
									context: args.actions.bindLibrary({
										...args,
										spawnTagForm: (library) =>
											enq.spawn(args.actors.tagForm, { input: { library } })
									}).context
								}
							}
							enq.stop(context.tagForm)
							return {
								context: {
									library: undefined,
									tagForm: undefined,
									scope: args.event.scope,
									limit: 50
								}
							}
						},
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
							if (!args.guards.currentReader(args)) return
							enq.sendTo(
								required(args.context.library),
								(({ event }) => {
									if (event.type !== 'ATTACH_BOUND') throw new Error('Reader surface unavailable')
									return {
										type: 'READER_EVENT',
										event: {
											type: 'ATTACH_SURFACE',
											surface: event.surface,
											documentId: event.documentId,
											sources: event.sources
										}
									} satisfies LibraryEvent
								})(args)
							)
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
										const snapshot = context.library?.getSnapshot()
										const row = snapshot?.context.rows.find((row) => row.id === intent.id)
										return {
											...intent,
											previous: row?.tags ?? [],
											enabled: !!row && snapshot?.context.capability?.isCurrent() === true
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
				draining: {}
			}
		},
		settlingAcquisition: {
			invoke: {
				id: 'owner',
				src: 'owner',
				input: ({ context }: { context: Context }) => context.input
			},
			on: {
				OWNER_READY: (args) => {
					if (args.guards.custodyClear()) {
						return { target: 'closingSession', context: { session: args.event.session } }
					}
					return { target: 'failed' }
				},
				OWNER_EMPTY: (args) => {
					if (args.guards.custodyClear()) {
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
				onError: { target: 'failed' }
			}
		},
		closingAccountStore: {
			invoke: {
				id: 'closeAccountStore',
				src: 'closeTransport',
				input: ({ context }) => required(context.input.closeAccountStore),
				onDone: (args) => ({ target: args.guards.hasBroker(args) ? 'closingBroker' : 'closed' }),
				onError: { target: 'failed' }
			}
		},
		closingBroker: {
			invoke: {
				id: 'closeBroker',
				src: 'closeTransport',
				input: ({ context }) => required(context.input.closeBroker),
				onDone: { target: 'closed' },
				onError: { target: 'failed' }
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
