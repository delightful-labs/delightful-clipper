import type { EventPayload } from '../events.js'
import {
	types,
	type SnapshotFrom,
	createCallbackLogic,
	setup,
	createAsyncLogic,
	matchesState
} from 'xstate'
import { t, recoveryMessages } from '../../localization/index.js'
import { stateFeedback } from '../../contracts/feedback.js'
import type { NamedState } from '../../contracts/feedback.js'
import type { WorkflowMessage } from '../../contracts/feedback.js'
import { libraryMachine } from '../capture/library.js'
import { rootBootstrapMachine } from './root-bootstrap.js'
import {
	createSessionStartupMachine,
	createSessionReadinessMachine
} from 'delightful-local-first/session/workflow'
import type {
	SessionStartupReport,
	SessionReadinessReport,
	SessionReadinessScope
} from 'delightful-local-first/session/contracts'

import { restorationMachine } from 'delightful-local-first/restoration/workflow'
import type { RestorationReport } from 'delightful-local-first/restoration/contracts'
import type {
	AccountHost,
	AccountInput,
	AccountObservation,
	RootAccess,
	RootWrite
} from '../../contracts/account.js'
import type { ConnectionEvent, ConnectionObserver } from '../../contracts/connection.js'

type Event<Session extends object> =
	| ConnectionEvent
	| SessionStartupReport<Session>
	| SessionReadinessReport
	| { type: 'OBSERVED'; observation: AccountObservation }
	| {
			type: 'HOST_BOUND'
			scope: Context<Session>['scope']
			host: AccountHost
			observation: AccountObservation
	  }
	| { type: 'HOST_ADOPTED'; scope: Context<Session>['scope'] }
	| { type: 'CREATE' | 'LOGOUT' | 'RETRY' | 'SHUTDOWN' }
	| { type: 'RESTORE'; phrase: string }
	| RestorationReport
	| {
			type:
				| 'OBSERVATION_RESTARTED'
				| 'STARTUP_CLOSED'
				| 'FEEDBACK_CLEAR'
				| 'IDENTITY_FAILED'
				| 'RESTORE_INVALID'
				| 'RESTORE_FAILED'
	  }

type Context<Session extends object> = {
	clean: boolean
	pendingBinding: Readonly<{ session: Session }> | undefined
	host: AccountHost | undefined
	input: AccountInput<Session>
	scope: AccountInput<Session>['startup']['scope']
	readinessScope: SessionReadinessScope | undefined
	retryAttempt: number
	observationAttempt: number
	observation: AccountObservation
	write: RootWrite | undefined
	phrase: string
	attempt: number
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Account capability unavailable')
	return value
}
function root<Session extends object>(context: Context<Session>): RootAccess {
	if (context.observation.status !== 'ready') throw new Error('Library scope unavailable')
	return context.observation.root
}
function observe(host: AccountHost): AccountObservation {
	try {
		return host.read()
	} catch {
		return { status: 'error' as const }
	}
}

type AccountFeedback = 'identityFailed' | 'restoreFailed' | 'restoreInvalid'
type AccountMeta = NamedState & {
	name: string
	variant: WorkflowMessage['variant']
	status?: MachineStatus
	feedback?: AccountFeedback
}
function accountStatus(status: MachineStatus, name: string): AccountMeta {
	return { status, name, variant: 'info' as const, channel: 'account' }
}
const configuration = accountStatus('working', t('account.status.configuration'))
const starting = accountStatus('starting', t('account.status.starting'))
const working = accountStatus('working', t('account.status.working'))
function isRestored(result: { outcome: string }) {
	return result.outcome === 'restored'
}
function isInvalidRestoration(result: { outcome: string }) {
	return result.outcome === 'invalid'
}

export function createApplicationReadinessMachine<Session extends object>(
	observeConnection?: ConnectionObserver
) {
	const accountActors = {
		binding: createCallbackLogic<
			{ type: 'ADOPT' },
			{ session: Session; account: AccountInput<Session>; scope: Context<Session>['scope'] }
		>(({ input, receive, sendBack }) => {
			// The native adapter retains custody until the chart acknowledges adoption.
			const host = input.account.bind(input.session)
			let adopted = false
			receive(() => {
				adopted = true
				sendBack({ type: 'HOST_ADOPTED', scope: input.scope })
			})
			sendBack({ type: 'HOST_BOUND', scope: input.scope, host, observation: observe(host) })
			return () => {
				if (!adopted) host.release()
			}
		}),
		observation: createCallbackLogic<{ type: 'READ' }, AccountHost>(
			({ input, receive, sendBack }) => {
				receive(() => sendBack({ type: 'OBSERVED', observation: observe(input) }))
			}
		),
		connection: createCallbackLogic<ConnectionEvent>(({ sendBack }) =>
			observeConnection?.(sendBack)
		),
		library: libraryMachine,
		startup: createSessionStartupMachine<Session>(),
		readiness: createSessionReadinessMachine(),
		prepare: createAsyncLogic({
			run: ({ input }: { input: AccountHost }) => required(input.prepare)()
		}),
		create: createAsyncLogic({ run: ({ input }: { input: AccountHost }) => input.create() }),
		logout: createAsyncLogic({ run: ({ input }: { input: AccountHost }) => input.logout() }),
		bootstrap: rootBootstrapMachine,
		global: createAsyncLogic({ run: ({ input }: { input: RootWrite }) => input.global() }),
		restore: restorationMachine
	}

	const model = setup({
		schemas: {
			context: types<Context<Session>>(),
			events: {
				HOST_BOUND: types<EventPayload<Event<Session>, 'HOST_BOUND'>>(),
				HOST_ADOPTED: types<EventPayload<Event<Session>, 'HOST_ADOPTED'>>(),
				ONLINE: types<EventPayload<Event<Session>, 'ONLINE'>>(),
				OFFLINE: types<EventPayload<Event<Session>, 'OFFLINE'>>(),
				SESSION_STARTING: types<EventPayload<Event<Session>, 'SESSION_STARTING'>>(),
				SESSION_STARTUP_FAILED: types<EventPayload<Event<Session>, 'SESSION_STARTUP_FAILED'>>(),
				SESSION_STATUS: types<EventPayload<Event<Session>, 'SESSION_STATUS'>>(),
				SESSION_OBSERVATION_FAILED:
					types<EventPayload<Event<Session>, 'SESSION_OBSERVATION_FAILED'>>(),
				SESSION_OBSERVATION_CLEANUP_FAILED:
					types<EventPayload<Event<Session>, 'SESSION_OBSERVATION_CLEANUP_FAILED'>>(),
				SESSION_RETRY_STARTED: types<EventPayload<Event<Session>, 'SESSION_RETRY_STARTED'>>(),
				SESSION_RETRY_SETTLED: types<EventPayload<Event<Session>, 'SESSION_RETRY_SETTLED'>>(),
				OBSERVED: types<EventPayload<Event<Session>, 'OBSERVED'>>(),
				RETRY: types<EventPayload<Event<Session>, 'RETRY'>>(),
				SHUTDOWN: types<EventPayload<Event<Session>, 'SHUTDOWN'>>(),
				CREATE: types<EventPayload<Event<Session>, 'CREATE'>>(),
				LOGOUT: types<EventPayload<Event<Session>, 'LOGOUT'>>(),
				RESTORE: types<EventPayload<Event<Session>, 'RESTORE'>>(),
				RESTORATION_VALIDATED: types<EventPayload<Event<Session>, 'RESTORATION_VALIDATED'>>(),
				RESTORATION_PREPARE_REQUESTED:
					types<EventPayload<Event<Session>, 'RESTORATION_PREPARE_REQUESTED'>>(),
				OBSERVATION_RESTARTED: types<EventPayload<Event<Session>, 'OBSERVATION_RESTARTED'>>(),
				STARTUP_CLOSED: types<EventPayload<Event<Session>, 'STARTUP_CLOSED'>>(),
				FEEDBACK_CLEAR: types<EventPayload<Event<Session>, 'FEEDBACK_CLEAR'>>(),
				IDENTITY_FAILED: types<EventPayload<Event<Session>, 'IDENTITY_FAILED'>>(),
				RESTORE_INVALID: types<EventPayload<Event<Session>, 'RESTORE_INVALID'>>(),
				RESTORE_FAILED: types<EventPayload<Event<Session>, 'RESTORE_FAILED'>>(),
				SESSION_ACQUIRED: types<EventPayload<Event<Session>, 'SESSION_ACQUIRED'>>()
			},
			input: types<AccountInput<Session>>(),
			output: types<{ clean: boolean }>(),
			meta: types<AccountMeta>(),
			children: {
				binding: types<import('xstate').ActorRefFrom<(typeof accountActors)['binding']>>(),
				observation: types<import('xstate').ActorRefFrom<(typeof accountActors)['observation']>>(),
				connection: types<import('xstate').ActorRefFrom<(typeof accountActors)['connection']>>(),
				library: types<import('xstate').ActorRefFrom<(typeof accountActors)['library']>>(),
				startup: types<import('xstate').ActorRefFrom<(typeof accountActors)['startup']>>(),
				readiness: types<import('xstate').ActorRefFrom<(typeof accountActors)['readiness']>>(),
				prepare: types<import('xstate').ActorRefFrom<(typeof accountActors)['prepare']>>(),
				create: types<import('xstate').ActorRefFrom<(typeof accountActors)['create']>>(),
				logout: types<import('xstate').ActorRefFrom<(typeof accountActors)['logout']>>(),
				bootstrap: types<import('xstate').ActorRefFrom<(typeof accountActors)['bootstrap']>>(),
				global: types<import('xstate').ActorRefFrom<(typeof accountActors)['global']>>(),
				restore: types<import('xstate').ActorRefFrom<(typeof accountActors)['restore']>>()
			}
		},
		actors: accountActors,
		guards: {
			existingRoot: (
				_args: { context: Context<Session> },
				result: { outcome: string; write?: RootWrite }
			) => result.outcome === 'ready' && result.write === undefined,
			observationBroken: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ active: { observationHealth: 'failed' } }, value),
			ownerBroken: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ active: { ownerHealth: 'failed' } }, value),
			cleanupBroken: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ active: { cleanupHealth: 'failed' } }, value),
			failedOwner: ({ context, event }: { context: Context<Session>; event: Event<Session> }) =>
				event.type === 'SESSION_STARTUP_FAILED' &&
				event.reason === 'ownerFailed' &&
				event.scope.binding === context.scope.binding &&
				event.scope.attachment === context.scope.attachment &&
				event.scope.generation === context.scope.generation,
			currentReadinessScope: ({
				context,
				event
			}: {
				context: Context<Session>
				event: Event<Session>
			}) =>
				'scope' in event &&
				event.scope.binding === context.readinessScope?.binding &&
				event.scope.attachment === context.readinessScope?.attachment,

			currentStartup: ({ context, event }: { context: Context<Session>; event: Event<Session> }) =>
				'scope' in event &&
				'generation' in event.scope &&
				event.scope.binding === context.scope.binding &&
				event.scope.attachment === context.scope.attachment &&
				event.scope.generation === context.scope.generation,
			currentReadiness: ({
				context,
				event
			}: {
				context: Context<Session>
				event: Event<Session>
			}) =>
				'scope' in event &&
				event.scope.binding === context.readinessScope?.binding &&
				event.scope.attachment === context.readinessScope?.attachment &&
				'observation' in event &&
				event.observation === context.observationAttempt,

			stoppingPreparation: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ active: { flow: { running: { preparing: 'stopping' } } } }, value),
			needsLocalFirst: ({ context }: { context: Context<Session> }) =>
				context.observation.status === 'ready' &&
				context.observation.localFirst === false &&
				!!context.host?.prepare,
			stoppingCreate: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ active: { flow: { running: { creating: 'stopping' } } } }, value),
			stoppingRestore: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ active: { flow: { running: { restoring: 'stopping' } } } }, value),
			stoppingLogout: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ active: { flow: { running: { loggingOut: 'stopping' } } } }, value),
			stoppingBootstrap: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ active: { flow: { running: { library: 'stopping' } } } }, value),
			replacingBootstrap: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ active: { flow: { running: { library: 'replacing' } } } }, value),
			sameBinding: ({ context, event }: { context: Context<Session>; event: Event<Session> }) =>
				event.type === 'OBSERVED' &&
				event.observation.status === 'ready' &&
				context.observation.status === 'ready' &&
				event.observation.binding === context.observation.binding
		},
		actions: {
			clearPhrase: () => ({ context: { phrase: '' } }),
			clearResources: () => ({
				context: {
					host: undefined,
					write: undefined,
					observation: { status: 'closed' as const },
					phrase: ''
				}
			}),
			rememberObservation: ({ event }: { event: Event<Session> }) => ({
				context: event.type === 'OBSERVED' ? { observation: event.observation } : {}
			})
		}
	})

	return model.createMachine({
		id: 'application-readiness',
		options: { maxIterations: 1000 },
		initial: 'active',
		output: ({ context }) => ({ clean: context.clean }),
		context: ({ input }) => ({
			clean: false,
			pendingBinding: undefined,
			input,
			scope: input.startup.scope,
			readinessScope: undefined,
			retryAttempt: 0,
			observationAttempt: 0,
			host: undefined,
			observation: { status: 'signed-out' as const },
			write: undefined,
			phrase: '',
			attempt: 0
		}),

		entry: (args, enq) => {
			enq.sendTo('startup', { type: 'START' as const, ...args.context.input.startup })
		},
		invoke: {
			id: 'startup',
			src: 'startup',
			input: ({ self }) => ({ reportTo: self }),
			onDone: (args, enq) => {
				enq.raise({ type: 'STARTUP_CLOSED' as const })
			}
		},
		states: {
			active: {
				type: 'parallel' as const,
				states: {
					connection: {
						initial: 'observing',
						states: {
							observing: {
								initial: 'checking',
								invoke: { id: 'connection', src: 'connection' },
								on: {
									ONLINE: { target: '.online' },
									OFFLINE: { target: '.offline' },
									SHUTDOWN: { target: 'closed' }
								},
								states: {
									checking: {},
									online: {
										meta: {
											name: t('connection.online'),
											variant: 'info' as const,
											channel: 'connection'
										}
									},
									offline: {
										meta: {
											name: t('connection.offline'),
											variant: 'info' as const,
											channel: 'connection'
										}
									}
								}
							},
							closed: {}
						}
					},
					feedback: {
						initial: 'none',
						on: {
							FEEDBACK_CLEAR: { target: '.none' },
							IDENTITY_FAILED: { target: '.identityFailed' },
							RESTORE_INVALID: { target: '.restoreInvalid' },
							RESTORE_FAILED: { target: '.restoreFailed' }
						},
						states: {
							none: {},
							identityFailed: {
								meta: {
									channel: 'feedback',
									feedback: 'identityFailed',
									name: t('account.feedback.identityFailed'),
									variant: 'error' as const
								}
							},
							restoreInvalid: {
								meta: {
									channel: 'feedback',
									feedback: 'restoreInvalid',
									name: t('account.feedback.restoreInvalid'),
									variant: 'error' as const
								}
							},
							restoreFailed: {
								meta: {
									channel: 'feedback',
									feedback: 'restoreFailed',
									name: t('account.feedback.restoreFailed'),
									variant: 'error' as const
								}
							}
						}
					},
					flow: {
						id: 'application-flow',
						initial: 'opening',
						on: {
							STARTUP_CLOSED: { target: '.finished' },
							SESSION_STARTING: (args) => {
								const { context, event } = args
								return {
									context:
										event.scope.binding === context.scope.binding &&
										event.scope.attachment === context.scope.attachment
											? { scope: event.scope }
											: {}
								}
							},
							SESSION_ACQUIRED: (args) => {
								if (!args.guards.currentStartup(args)) return
								return {
									target: '.binding',
									context: { pendingBinding: { session: args.event.session } }
								}
							},
							SESSION_STARTUP_FAILED: (args, enq) => {
								if (args.guards.failedOwner(args)) {
									enq.raise({ type: 'SHUTDOWN' as const })
									return {}
								}
								if (args.guards.currentStartup(args)) {
									return { target: '.openFailed' }
								}
							},
							SESSION_OBSERVATION_CLEANUP_FAILED: (args, enq) => {
								if (!args.guards.currentReadinessScope(args)) return
								enq.raise({ type: 'SHUTDOWN' as const })
							},
							SHUTDOWN: { target: '.closing' }
						},
						states: {
							opening: { meta: accountStatus('starting', t('account.status.starting')) },
							openFailed: {
								meta: accountStatus('unavailable', t('account.status.unavailable')),
								on: {
									RETRY: (args, enq) => {
										enq.sendTo('startup', { type: 'RETRY' as const })
										return { target: 'opening' }
									}
								}
							},
							binding: {
								meta: starting,
								initial: 'waiting',
								invoke: {
									id: 'binding',
									src: 'binding',
									input: ({ context }) => ({
										session: required(context.pendingBinding).session,
										account: context.input,
										scope: context.scope
									}),
									onError: { target: 'openFailed' }
								},
								on: { SHUTDOWN: { target: '.stopping' } },
								states: {
									waiting: {
										on: {
											HOST_BOUND: (args) => {
												if (!args.guards.currentStartup(args)) return
												const { host, observation } = args.event
												return {
													target: 'adopting',
													context: {
														host,
														observation,
														pendingBinding: undefined,
														readinessScope: { binding: host.readiness.binding, attachment: {} }
													}
												}
											}
										}
									},
									adopting: {
										entry: (_args, enq) => {
											enq.sendTo('binding', { type: 'ADOPT' })
										},
										on: { HOST_ADOPTED: { target: '#application-readiness.active.flow.running' } }
									},
									stopping: {
										on: {
											HOST_BOUND: {
												target: '#application-readiness.active.flow.closing',
												context: { pendingBinding: undefined }
											},
											HOST_ADOPTED: { target: '#application-readiness.active.flow.closing' }
										}
									}
								}
							},
							running: {
								initial: 'route',

								entry: (args, enq) => {
									const { context } = args
									enq.sendTo('readiness', {
										type: 'BIND' as const,
										scope: required(context.readinessScope),
										capability: required(context.host).readiness.capability
									})
								},
								invoke: [
									{
										id: 'readiness',
										src: 'readiness',
										input: ({ self }) => ({ reportTo: self }),
										onDone: { target: '#application-readiness.active.flow.closing' }
									},
									{
										id: 'observation',
										src: 'observation',
										input: ({ context }) => required(context.host)
									}
								],
								on: {
									SHUTDOWN: { target: '.draining' },
									OBSERVED: (args) => {
										return { context: args.actions.rememberObservation(args).context }
									},
									SESSION_STATUS: (args, enq) => {
										if (!args.guards.currentReadiness(args)) return
										enq.sendTo('observation', { type: 'READ' })
									},
									SESSION_OBSERVATION_FAILED: (args, enq) => {
										if (!args.guards.currentReadiness(args)) return
										enq.raise({
											type: 'OBSERVED' as const,
											observation: { status: 'error' as const }
										})
									}
								},
								states: {
									draining: {
										meta: accountStatus('closing', t('account.status.closing')),
										entry: (args, enq) => {
											enq.sendTo('readiness', { type: 'SHUTDOWN' as const })
										},
										on: {
											OBSERVED: {},
											SHUTDOWN: {},
											SESSION_STATUS: {},
											SESSION_OBSERVATION_FAILED: {}
										}
									},
									refreshing: {
										meta: working,
										entry: (_args, enq) => {
											enq.sendTo('observation', { type: 'READ' })
										},
										on: {
											OBSERVED: (args) => ({
												target: 'route',
												context: args.actions.rememberObservation(args).context
											})
										}
									},
									route: {
										entry: () => {
											return { context: { write: undefined } }
										},
										always: (args) => {
											const { context } = args
											if (matchesState({ active: { observationHealth: 'failed' } }, args.value)) {
												return {
													target: 'unavailable',
													context: { observation: { status: 'error' as const } }
												}
											}
											if (args.guards.needsLocalFirst(args)) {
												return { target: 'preparing' }
											}
											if (context.observation.status === 'ready') {
												return { target: 'library' }
											}
											if (context.observation.status === 'signed-out') {
												return { target: 'signedOut' }
											}
											if (context.observation.status === 'transitioning') {
												return { target: 'waiting' }
											}
											return { target: 'unavailable' }
										}
									},
									preparing: {
										meta: starting,
										initial: 'active',
										states: { active: {}, stopping: {} },
										on: { SHUTDOWN: { target: '.stopping' } },
										invoke: {
											id: 'prepare',
											src: 'prepare',
											input: ({ context }: { context: Context<Session> }) => required(context.host),
											onDone: (args, _enq) => {
												let pendingContext = {}

												if (args.guards.stoppingPreparation(args)) {
													return { context: pendingContext, target: 'draining' }
												}

												return { context: pendingContext, target: 'refreshing' }
											},
											onError: (args) => {
												if (args.guards.stoppingPreparation(args)) {
													return { target: 'draining' }
												}
												return {
													target: 'unavailable',
													context: { observation: { status: 'error' as const } }
												}
											}
										}
									},
									signedOut: {
										meta: accountStatus('signedOut', t('account.status.signedOut')),
										on: {
											OBSERVED: (args) => {
												return {
													target: 'route',
													context: args.actions.rememberObservation(args).context
												}
											},
											CREATE: (args, enq) => {
												enq.raise({ type: 'FEEDBACK_CLEAR' as const })
												return { target: 'creating' }
											},
											RESTORE: (args) => {
												return {
													target: 'restoring',
													context: { phrase: args.event.phrase, attempt: args.context.attempt + 1 }
												}
											}
										}
									},
									waiting: {
										on: {
											OBSERVED: (args) => {
												return {
													target: 'route',
													context: args.actions.rememberObservation(args).context
												}
											}
										}
									},
									unavailable: {
										meta: accountStatus('unavailable', t('account.status.unavailable')),
										on: {
											RETRY: (args) => {
												if (matchesState({ active: { observationHealth: 'failed' } }, args.value)) {
													return { target: 'reobserving' }
												}
												return { target: 'retrying' }
											},
											OBSERVED: (args) => {
												return {
													target: 'route',
													context: args.actions.rememberObservation(args).context
												}
											}
										}
									},

									retrying: {
										entry: (args, enq) => {
											let context = args.context
											let patch = {}
											patch = { ...patch, retryAttempt: context.retryAttempt + 1 }
											context = { ...args.context, ...patch }
											enq.sendTo('readiness', {
												type: 'RETRY' as const,
												scope: required(context.readinessScope),
												attempt: context.retryAttempt
											})
											return { context: patch }
										},
										on: {
											SESSION_RETRY_SETTLED: (args) => {
												const { context, event } = args
												if (
													!(
														event.scope.binding === context.readinessScope?.binding &&
														event.scope.attachment === context.readinessScope?.attachment &&
														event.attempt === context.retryAttempt
													)
												)
													return
												return { target: 'refreshing' }
											}
										}
									},
									reobserving: {
										entry: (args, enq) => {
											let context = args.context
											let patch = {}
											enq.raise({ type: 'OBSERVATION_RESTARTED' as const })
											patch = { ...patch, observationAttempt: context.observationAttempt + 1 }
											context = { ...args.context, ...patch }
											enq.sendTo('readiness', {
												type: 'REOBSERVE' as const,
												scope: required(context.readinessScope),
												observation: context.observationAttempt
											})
											return { context: patch }
										},
										on: {
											OBSERVED: (args) => {
												return {
													target: 'route',
													context: args.actions.rememberObservation(args).context
												}
											}
										}
									},
									creating: {
										entry: (args, enq) => {
											enq.raise({ type: 'FEEDBACK_CLEAR' as const })
										},
										initial: 'active',
										states: {
											active: {},
											stopping: { meta: accountStatus('closing', t('account.status.closing')) }
										},
										on: { SHUTDOWN: { target: '.stopping' } },
										invoke: {
											id: 'create',
											src: 'create',
											input: ({ context }: { context: Context<Session> }) => required(context.host),
											onDone: (args, _enq) => {
												let pendingContext = {}

												if (args.guards.stoppingCreate(args)) {
													return {
														context: pendingContext,
														target: '#application-readiness.active.flow.running.draining'
													}
												}

												return { context: pendingContext, target: 'refreshing' }
											},
											onError: (args, enq) => {
												let pendingContext = {}

												if (args.guards.stoppingCreate(args)) {
													return {
														context: pendingContext,
														target: '#application-readiness.active.flow.running.draining'
													}
												}
												enq.raise({ type: 'IDENTITY_FAILED' as const })

												return { context: pendingContext, target: 'refreshing' }
											}
										}
									},
									restoring: {
										entry: (args, enq) => {
											enq.raise({ type: 'FEEDBACK_CLEAR' as const })
										},
										initial: 'active',
										states: {
											active: {},
											stopping: { meta: accountStatus('closing', t('account.status.closing')) }
										},
										on: {
											SHUTDOWN: (args, enq) => {
												enq.sendTo('restore', { type: 'SHUTDOWN' as const })
												return { target: '.stopping', context: args.actions.clearPhrase().context }
											},
											RESTORATION_VALIDATED: (args) => {
												return { context: args.actions.clearPhrase().context }
											},
											RESTORATION_PREPARE_REQUESTED: (args, enq) => {
												const { event } = args
												enq.sendTo('restore', {
													type: 'PREPARED' as const,
													binding: event.binding,
													attempt: event.attempt
												})
											}
										},
										invoke: {
											id: 'restore',
											src: 'restore',
											input: ({ context, self }) => ({
												capability: required(context.host).restoration.capability,
												scope: {
													binding: required(context.host).restoration.binding,
													attempt: context.attempt
												},
												phrase: context.phrase,
												reportTo: self
											}),
											onDone: (args, enq) => {
												let pendingContext = {}

												const { event } = args
												if (args.guards.stoppingRestore(args)) {
													pendingContext = {
														...pendingContext,
														...(() => args.actions.clearPhrase().context)()
													}
													return {
														context: pendingContext,
														target: '#application-readiness.active.flow.running.draining'
													}
												}
												if (isRestored(event.output)) {
													enq.raise({ type: 'FEEDBACK_CLEAR' as const })
													pendingContext = {
														...pendingContext,
														...(() => args.actions.clearPhrase().context)()
													}

													return { context: pendingContext, target: 'refreshing' }
												}
												if (isInvalidRestoration(event.output)) {
													enq.raise({ type: 'RESTORE_INVALID' as const })
													pendingContext = {
														...pendingContext,
														...(() => args.actions.clearPhrase().context)()
													}

													return { context: pendingContext, target: 'refreshing' }
												}
												enq.raise({ type: 'RESTORE_FAILED' as const })
												pendingContext = {
													...pendingContext,
													...(() => args.actions.clearPhrase().context)()
												}

												return { context: pendingContext, target: 'refreshing' }
											},
											onError: (args, enq) => {
												let pendingContext = {}

												if (args.guards.stoppingRestore(args)) {
													pendingContext = {
														...pendingContext,
														...(() => args.actions.clearPhrase().context)()
													}
													return {
														context: pendingContext,
														target: '#application-readiness.active.flow.running.draining'
													}
												}
												enq.raise({ type: 'RESTORE_FAILED' as const })
												pendingContext = {
													...pendingContext,
													...(() => args.actions.clearPhrase().context)()
												}

												return { context: pendingContext, target: 'refreshing' }
											}
										}
									},
									loggingOut: {
										initial: 'active',
										states: {
											active: {},
											stopping: { meta: accountStatus('closing', t('account.status.closing')) }
										},
										on: { SHUTDOWN: { target: '.stopping' } },
										invoke: {
											id: 'logout',
											src: 'logout',
											input: ({ context }: { context: Context<Session> }) => required(context.host),
											onDone: (args, _enq) => {
												let pendingContext = {}

												if (args.guards.stoppingLogout(args)) {
													return {
														context: pendingContext,
														target: '#application-readiness.active.flow.running.draining'
													}
												}

												return { context: pendingContext, target: 'refreshing' }
											},
											onError: (args, enq) => {
												let pendingContext = {}

												if (args.guards.stoppingLogout(args)) {
													return {
														context: pendingContext,
														target: '#application-readiness.active.flow.running.draining'
													}
												}
												enq.raise({ type: 'IDENTITY_FAILED' as const })

												return { context: pendingContext, target: 'refreshing' }
											}
										}
									},

									library: {
										initial: 'bootstrapping',
										invoke: {
											id: 'bootstrap',
											src: 'bootstrap',
											input: ({ context }: { context: Context<Session> }) => root(context),
											onDone: (args) => {
												const { event } = args
												if (args.guards.stoppingBootstrap(args)) {
													return { target: '#application-readiness.active.flow.running.draining' }
												}
												if (args.guards.replacingBootstrap(args)) {
													return { target: '#application-readiness.active.flow.running.route' }
												}
												if (args.guards.existingRoot(args, event.output)) {
													return { target: '.ready.existing', context: { write: undefined } }
												}
												if (event.output.outcome === 'ready') {
													return {
														target: '.ready.syncPending',
														context: {
															write:
																event.output.outcome === 'ready' ? event.output.write : undefined
														}
													}
												}
												if (event.output.outcome === 'conflict') {
													return { target: '.conflict' }
												}
												return { target: '.failed' }
											}
										},
										on: {
											OBSERVED: (args) => {
												if (args.guards.sameBinding(args)) {
													return {}
												}
												return {
													target: '#application-readiness.active.flow.running.route',
													context: args.actions.rememberObservation(args).context
												}
											}
										},
										states: {
											bootstrapping: {
												meta: accountStatus('openingLibrary', t('account.status.openingLibrary')),
												on: {
													SHUTDOWN: (args, enq) => {
														enq.sendTo('bootstrap', { type: 'SHUTDOWN' as const })
														return { target: 'stopping' }
													},
													OBSERVED: (args, enq) => {
														if (args.guards.sameBinding(args)) {
															return {}
														}
														enq.sendTo('bootstrap', { type: 'SHUTDOWN' as const })
														return {
															target: 'replacing',
															context: args.actions.rememberObservation(args).context
														}
													}
												}
											},
											stopping: {
												meta: accountStatus('closing', t('account.status.closing')),
												on: {
													SHUTDOWN: {},
													OBSERVED: (args) => {
														return { context: args.actions.rememberObservation(args).context }
													}
												}
											},
											replacing: {
												meta: accountStatus('openingLibrary', t('account.status.openingLibrary')),
												on: {
													OBSERVED: (args) => {
														return { context: args.actions.rememberObservation(args).context }
													},
													SHUTDOWN: { target: 'stopping' }
												}
											},
											conflict: {
												meta: accountStatus('conflict', t('account.status.conflict')),
												on: {
													LOGOUT: {
														target: '#application-readiness.active.flow.running.loggingOut'
													}
												}
											},
											failed: {
												meta: accountStatus('rootFailed', t('account.status.rootFailed')),
												on: {
													RETRY: {
														target: '#application-readiness.active.flow.running.library',
														reenter: true
													},
													LOGOUT: {
														target: '#application-readiness.active.flow.running.loggingOut'
													}
												}
											},
											ready: {
												initial: 'syncPending',
												invoke: {
													id: 'library',
													src: 'library',
													input: ({ context }: { context: Context<Session> }) =>
														context.observation.status === 'ready'
															? context.observation.library
															: undefined,
													onDone: (args) => {
														if (
															(({ value }: { value: import('xstate').StateValue }) =>
																matchesState(
																	{
																		active: {
																			flow: {
																				running: { library: { ready: { stopping: 'restore' } } }
																			}
																		}
																	},
																	value
																))(args)
														) {
															return {
																target: '#application-readiness.active.flow.running.restoring'
															}
														}
														if (
															(({ value }: { value: import('xstate').StateValue }) =>
																matchesState(
																	{
																		active: {
																			flow: {
																				running: { library: { ready: { stopping: 'logout' } } }
																			}
																		}
																	},
																	value
																))(args)
														) {
															return {
																target: '#application-readiness.active.flow.running.loggingOut'
															}
														}
														if (
															(({ value }: { value: import('xstate').StateValue }) =>
																matchesState(
																	{
																		active: {
																			flow: {
																				running: { library: { ready: { stopping: 'replace' } } }
																			}
																		}
																	},
																	value
																))(args)
														) {
															return { target: '#application-readiness.active.flow.running.route' }
														}
														return { target: '#application-readiness.active.flow.running.draining' }
													}
												},
												on: {
													RESTORE: (args, enq) => {
														enq.raise({ type: 'FEEDBACK_CLEAR' as const })
														enq.sendTo('library', { type: 'SHUTDOWN' as const })
														return {
															target: '.stopping.restore',
															context: {
																phrase: args.event.phrase,
																attempt: args.context.attempt + 1
															}
														}
													},
													LOGOUT: (args, enq) => {
														enq.sendTo('library', { type: 'SHUTDOWN' as const })
														return { target: '.stopping.logout' }
													},
													SHUTDOWN: (args, enq) => {
														enq.sendTo('library', { type: 'SHUTDOWN' as const })
														return { target: '.stopping.shutdown' }
													},
													OBSERVED: (args, enq) => {
														if (args.guards.sameBinding(args)) {
															return {}
														}
														enq.sendTo('library', { type: 'SHUTDOWN' as const })
														return {
															target: '.stopping.replace',
															context: args.actions.rememberObservation(args).context
														}
													}
												},
												states: {
													// Existing local data is ready without claiming a new save or remote receipt.
													existing: { meta: accountStatus('ready', '') },
													stopping: {
														initial: 'shutdown',
														states: { shutdown: {}, restore: {}, logout: {}, replace: {} },
														meta: accountStatus('closing', t('account.status.closing')),
														on: {
															LOGOUT: {},
															RESTORE: {},
															SHUTDOWN: { target: '.shutdown' },
															OBSERVED: (args) => {
																return { context: args.actions.rememberObservation(args).context }
															}
														}
													},
													syncPending: {
														meta: accountStatus('localSaved', t('account.status.localSaved')),
														invoke: {
															id: 'global',
															src: 'global',
															input: ({ context }: { context: Context<Session> }) =>
																required(context.write),
															onDone: { target: 'synced' },
															onError: { target: 'syncFailed' }
														}
													},
													synced: { meta: accountStatus('synced', t('account.status.synced')) },
													syncFailed: {
														meta: accountStatus('syncFailed', t('account.status.syncFailed')),
														on: {
															RETRY: { target: 'syncPending' }
														}
													}
												}
											}
										}
									}
								}
							},
							closing: {
								meta: accountStatus('closing', t('account.status.closing')),
								entry: (args, enq) => {
									let context = args.context
									let patch = {}
									patch = { ...patch, ...args.actions.clearPhrase().context }
									context = { ...args.context, ...patch }
									enq(() => context.host?.release())
									enq.sendTo('startup', { type: 'SHUTDOWN' as const })
									return { context: patch }
								},
								on: {
									SESSION_ACQUIRED: {},
									SESSION_STARTUP_FAILED: {},
									SESSION_STARTING: {},
									SHUTDOWN: {}
								}
							},
							finished: {
								type: 'choice',
								choice: (args) => {
									if (matchesState({ active: { cleanupHealth: 'failed' } }, args.value)) {
										return { target: '#application-readiness.cleanupFailed' }
									}
									if (matchesState({ active: { ownerHealth: 'failed' } }, args.value)) {
										return { target: '#application-readiness.ownerFailed' }
									}
									return { target: '#application-readiness.closed' }
								}
							}
						}
					},
					ownerHealth: {
						initial: 'healthy',
						states: {
							healthy: {
								on: {
									SESSION_STARTUP_FAILED: (args) => {
										if (!args.guards.failedOwner(args)) return
										return { target: 'failed' }
									}
								}
							},
							failed: {}
						}
					},
					cleanupHealth: {
						initial: 'healthy',
						states: {
							healthy: {
								on: {
									SESSION_OBSERVATION_CLEANUP_FAILED: (args) => {
										if (!args.guards.currentReadinessScope(args)) return
										return { target: 'failed' }
									}
								}
							},
							failed: {}
						}
					},
					observationHealth: {
						initial: 'healthy',
						on: { OBSERVATION_RESTARTED: { target: '.healthy' } },
						states: {
							healthy: {
								on: {
									SESSION_OBSERVATION_FAILED: (args) => {
										if (!args.guards.currentReadiness(args)) return
										return { target: 'failed' }
									}
								}
							},
							failed: {}
						}
					}
				}
			},
			cleanupFailed: {
				meta: accountStatus('cleanupFailed', t('account.status.cleanupFailed')),
				type: 'final' as const,
				entry: (args) => {
					return { context: args.actions.clearResources().context }
				}
			},
			ownerFailed: {
				meta: accountStatus('ownerFailed', t('account.status.ownerFailed')),
				type: 'final' as const,
				entry: (args) => {
					return { context: args.actions.clearResources().context }
				}
			},
			closed: {
				meta: accountStatus('closed', t('account.status.closed')),
				type: 'final' as const,
				entry: () => {
					return {
						context: {
							host: undefined,
							write: undefined,
							clean: true,
							observation: { status: 'closed' as const },
							phrase: ''
						}
					}
				}
			}
		}
	})
}

export type ApplicationStatus =
	| 'ready'
	| 'configuration'
	| 'starting'
	| 'signedOut'
	| 'synced'
	| 'syncFailed'
	| 'localSaved'
	| 'rootFailed'
	| 'conflict'
	| 'openingLibrary'
	| 'unavailable'
	| 'closing'
	| 'closed'
	| 'working'
	| 'ownerFailed'
	| 'cleanupFailed'
export type ApplicationSnapshot<Session extends object> = SnapshotFrom<
	ReturnType<typeof createApplicationReadinessMachine<Session>>
>
type MachineStatus = Exclude<ApplicationStatus, 'configuration'>
export function selectApplicationView<Session extends object>(
	snapshot: ApplicationSnapshot<Session> | undefined,
	configured: boolean
) {
	const metadata = snapshot ? Object.values(snapshot.getMeta()) : [starting]
	const meta = configured
		? (metadata.find((state) => state?.channel === 'account') ?? working)
		: configuration
	const feedback = metadata.find((state) => state?.channel === 'feedback')?.feedback
	const status: ApplicationStatus = configured ? (meta.status ?? 'working') : 'configuration'
	return {
		status,
		message: { text: meta.name, variant: meta.variant },
		feedbackMessage: stateFeedback(metadata, 'feedback'),
		connectionMessage: stateFeedback(metadata, 'connection'),
		feedback,
		showIdentityForm: snapshot?.can({ type: 'CREATE' as const }) ?? false,
		canLogout:
			snapshot?.context.observation.status === 'ready' &&
			snapshot.context.observation.signedIn === true &&
			snapshot.can({ type: 'LOGOUT' as const }),
		canRestore: snapshot?.can({ type: 'RESTORE' as const, phrase: '' }) ?? false,
		canRetry: snapshot?.can({ type: 'RETRY' as const }) ?? false,
		requiresReload: snapshot?.matches('ownerFailed') || snapshot?.matches('cleanupFailed') || false
	}
}
export function selectRecoveryBinding<Session extends object>(
	snapshot: ApplicationSnapshot<Session> | undefined
) {
	return snapshot &&
		selectLibraryActor(snapshot) &&
		!snapshot.matches({ active: { ownerHealth: 'failed' } }) &&
		!snapshot.matches({ active: { cleanupHealth: 'failed' } }) &&
		snapshot.context.observation.status === 'ready'
		? { ...snapshot.context.observation.recovery, messages: recoveryMessages() }
		: undefined
}

/** The invocation ID is owned by ready; never expose actors from a draining binding. */
export function selectLibraryActor<Session extends object>(
	snapshot: ApplicationSnapshot<Session> | undefined
) {
	return snapshot?.matches({ active: { flow: { running: { library: 'ready' } } } }) &&
		!snapshot.matches({ active: { flow: { running: { library: { ready: 'stopping' } } } } })
		? snapshot.children.library
		: undefined
}
