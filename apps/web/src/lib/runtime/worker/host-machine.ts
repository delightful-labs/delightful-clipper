import { atprotoMachine } from '../../machines/runtime/atproto.js'
import { hasDetachedTransactions } from '../../backend/jazz/transaction.js'
import { assign, fromCallback, fromPromise, raise, sendTo, setup, stopChild } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import type { Session } from '../../backend/jazz/account.js'
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
	callbackAttempt?: string | null | undefined
	authReturned?: () => void
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
	tagForm: ActorRefFrom<typeof tagFormMachine> | undefined
}
type Event =
	| RuntimeCommand
	| { type: 'OAUTH_REDIRECT'; url: string }
	| { type: 'OAUTH_RETURNED' }
	| { type: 'BIND_RECOVERY'; binding: RecoveryBinding | undefined }
	| { type: 'BIND_LIBRARY'; library: LibraryRef | undefined }
	| {
			type: 'ATTACH_BOUND'
			scope: string
			documentId: string
			sources: string[]
			surface: ReaderSurface
	  }
	| { type: 'SHUTDOWN' }
	| { type: 'OWNER_READY'; session: Session }
	| { type: 'OWNER_EMPTY' }
	| { type: 'APPLICATION_CLOSED'; clean: boolean }
const owner = fromCallback<SessionOwnerReply<Session>, Input>(
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
	close: fromPromise(({ input }: { input: Session }) => input.close())
}

/** Realm owner. Application detach drains domain work first; then wait for a
 * pending DLF acquisition and close its actual SDK session before releasing ports.
 * A failed drain never acknowledges safe worker termination. */
export const workerHostMachine = setup<
	Context,
	Event,
	typeof actors,
	{ application: 'application'; oauth: 'oauth' },
	{
		reportApplicationClosed: undefined
		bindLibrary: undefined
		forwardLibrary: undefined
		attachSurface: undefined
		forwardTagForm: undefined
		resetTagForm: undefined
		bindRecovery: undefined
		forwardRecovery: undefined
	},
	{
		custodyClear: undefined
		applicationDrained: undefined
		currentLibrary: undefined
		currentAccount: undefined
		currentReader: undefined
		resettingTags: undefined
		suppliedLibrary: undefined
		suppliedRecovery: undefined
		currentRecovery: undefined
	},
	never,
	string,
	Input
>({
	actors,
	guards: {
		custodyClear: () => !hasDetachedTransactions(),
		suppliedRecovery: ({ event }) => event.type === 'BIND_RECOVERY' && !!event.binding,
		currentRecovery: ({ context, event }) =>
			event.type === 'RECOVERY' && event.scope === context.scope && !!context.recovery,
		suppliedLibrary: ({ event }) => event.type === 'BIND_LIBRARY' && !!event.library,
		resettingTags: ({ context, event }) =>
			event.type === 'TAG_FORM' &&
			event.event.type === 'RESET' &&
			event.scope === context.scope &&
			!!context.tagForm,
		currentAccount: ({ context, event }) => 'scope' in event && event.scope === context.scope,
		currentReader: ({ context, event }) => {
			const reader = context.library?.getSnapshot().context.reader
			return (
				event.type === 'ATTACH_BOUND' &&
				event.scope === context.scope &&
				reader?.kind === 'available' &&
				reader.document.snapshotId === event.documentId
			)
		},
		currentLibrary: ({ context, event }) =>
			'scope' in event &&
			event.scope === context.scope &&
			!!context.library?.getSnapshot().context.capability?.isCurrent() &&
			context.library.getSnapshot().matches({ running: { control: 'active' } }),
		applicationDrained: ({ event }) => event.type === 'APPLICATION_CLOSED' && event.clean
	},
	actions: {
		bindRecovery: assign(({ event, spawn }) => {
			if (event.type !== 'BIND_RECOVERY') throw new Error('Recovery binding unavailable')
			return { recovery: spawn(createRecoveryOwner(required(event.binding)), { input: undefined }) }
		}),
		forwardRecovery: sendTo(
			({ context }) => required(context.recovery),
			({ event }) => {
				if (event.type !== 'RECOVERY') throw new Error('Recovery intent unavailable')
				return event.event
			}
		),
		bindLibrary: assign(({ event, spawn }) => {
			if (event.type !== 'BIND_LIBRARY') throw new Error('Library binding unavailable')
			const library = required(event.library)
			return {
				tagArticleId: '',
				library,
				scope: crypto.randomUUID(),
				limit: 50,
				tagForm: spawn('tagForm', { input: { library } })
			}
		}),
		forwardLibrary: sendTo(
			({ context }) => required(context.library),
			({ event }) => {
				if (event.type !== 'LIBRARY') throw new Error('Library intent unavailable')
				return event.event
			}
		),
		attachSurface: sendTo(
			({ context }) => required(context.library),
			({ event }) => {
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
			}
		),
		forwardTagForm: sendTo(
			({ context }) => required(context.tagForm),
			({ context, event }) => {
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
			}
		),
		resetTagForm: sendTo(({ context }) => required(context.tagForm), { type: 'RESET' }),
		reportApplicationClosed: raise(({ self }) => ({
			type: 'APPLICATION_CLOSED',
			clean: self.getSnapshot().children.application?.getSnapshot().matches('closed') === true
		}))
	}
}).createMachine({
	id: 'worker-host',
	initial: 'running',
	context: ({ input }) => ({
		input,
		redirect: undefined,
		recovery: undefined,
		session: undefined,
		library: undefined,
		scope: crypto.randomUUID(),
		limit: 50,
		tagForm: undefined,
		tagArticleId: ''
	}),
	states: {
		running: {
			initial: 'accepting',
			on: {
				APPLICATION_CLOSED: [
					{ guard: 'applicationDrained', target: 'settlingAcquisition' },
					{ target: 'failed' }
				]
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
					input: ({ context }) => context.input,
					onDone: { actions: 'reportApplicationClosed' },
					onError: 'failed'
				}
			],
			states: {
				accepting: {
					on: {
						ATPROTO: {
							guard: 'currentAccount',
							actions: sendTo('oauth', ({ event }) => ({
								type: 'BEGIN' as const,
								handle: event.handle
							}))
						},
						OAUTH_RETURNED: { actions: ({ context }) => context.input.authReturned?.() },
						OAUTH_REDIRECT: {
							target: 'draining',
							actions: [
								assign({ redirect: ({ event }) => event.url }),
								sendTo('application', { type: 'SHUTDOWN' })
							]
						},
						BIND_RECOVERY: [
							{
								guard: 'suppliedRecovery',
								actions: [
									stopChild(({ context }) => context.recovery ?? 'absent-recovery'),
									'bindRecovery'
								]
							},
							{
								actions: [
									stopChild(({ context }) => context.recovery ?? 'absent-recovery'),
									assign({ recovery: undefined })
								]
							}
						],
						RECOVERY: { guard: 'currentRecovery', actions: 'forwardRecovery' },
						BIND_LIBRARY: [
							{
								guard: 'suppliedLibrary',
								actions: [
									stopChild(({ context }) => context.tagForm ?? 'absent-tag-form'),
									'bindLibrary'
								]
							},
							{
								actions: [
									stopChild(({ context }) => context.tagForm ?? 'absent-tag-form'),
									assign({
										library: undefined,
										tagForm: undefined,
										scope: () => crypto.randomUUID(),
										limit: 50
									})
								]
							}
						],
						LIBRARY: {
							guard: 'currentLibrary',
							actions: [
								'forwardLibrary',
								assign(({ event, context }) =>
									['QUERY', 'FILTER', 'TAG_FILTER'].includes(event.event.type)
										? { limit: 50 }
										: { limit: context.limit }
								)
							]
						},
						TAG_EDIT: {
							guard: 'currentLibrary',
							actions: assign({ tagArticleId: ({ event }) => event.id ?? '' })
						},
						MORE: {
							guard: 'currentLibrary',
							actions: assign({ limit: ({ context }) => context.limit + 50 })
						},
						ATTACH_BOUND: { guard: 'currentReader', actions: 'attachSurface' },
						TAG_FORM: [
							{ guard: 'resettingTags', actions: 'resetTagForm' },
							{ guard: 'currentLibrary', actions: 'forwardTagForm' }
						],
						ACCOUNT: {
							guard: 'currentAccount',
							actions: sendTo('application', ({ event }) => event.event)
						},
						SHUTDOWN: { target: 'draining', actions: sendTo('application', { type: 'SHUTDOWN' }) }
					}
				},
				draining: {}
			}
		},
		settlingAcquisition: {
			invoke: { src: 'owner', input: ({ context }) => context.input },
			on: {
				OWNER_READY: [
					{
						guard: 'custodyClear',
						target: 'closingSession',
						actions: assign({ session: ({ event }) => event.session })
					},
					{ target: 'failed' }
				],
				OWNER_EMPTY: [{ guard: 'custodyClear', target: 'closed' }, { target: 'failed' }]
			}
		},
		closingSession: {
			invoke: {
				src: 'close',
				input: ({ context }) => {
					if (!context.session) throw new Error('Worker session unavailable')
					return context.session
				},
				onDone: 'closed',
				onError: 'failed'
			}
		},
		closed: {
			type: 'final',
			entry: [({ context }) => context.input.startup.owner.stop(), assign({ session: undefined })]
		},
		failed: {}
	}
})
export type WorkerHost = ActorRefFrom<typeof workerHostMachine>
