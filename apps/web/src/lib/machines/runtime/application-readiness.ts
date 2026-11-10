import { signOutMachine, signOutInput, type SignOutStage } from './sign-out.js'
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
import { sameAccountBinding, accountBindingIdentity } from '../../contracts/account.js'
import type {
	AccountBinding,
	AccountBindingIdentity,
	ReadyAccountObservation,
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
	| { type: 'LIBRARY_BOUND'; binding: AccountBinding }
	| { type: 'LIBRARY_ADOPTED' }
	| { type: 'SIGN_OUT_OVERDUE'; stage: SignOutStage }
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
	host: AccountHost | undefined
	input: AccountInput<Session>
	scope: AccountInput<Session>['startup']['scope']
	readinessScope: SessionReadinessScope | undefined
	retryAttempt: number
	observationAttempt: number
	observation: AccountObservation
	failedBinding: AccountBindingIdentity | undefined
	candidate: ReadyAccountObservation | undefined
	adoption: AccountBinding | undefined
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
		return { status: 'error' }
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
	return { status, name, variant: 'info', channel: 'account' }
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
		bindingCustody: createCallbackLogic<
			{ type: 'OWN' | 'RELEASE'; binding: AccountBinding },
			{ owner: { subscribe(observer: { error: () => void }): { unsubscribe: () => void } } }
		>(({ input, receive }) => {
			const bindings = new Set<AccountBinding>()
			const dispose = () => {
				for (const binding of bindings) binding.release()
				bindings.clear()
			}
			const subscription = input.owner.subscribe({ error: dispose })
			receive((event) => {
				if (event.type === 'OWN') bindings.add(event.binding)
				else {
					bindings.delete(event.binding)
					event.binding.release()
				}
			})
			return () => {
				subscription.unsubscribe()
				dispose()
			}
		}),
		libraryBinding: createCallbackLogic<
			{ type: 'ADOPT' },
			{
				host: AccountHost
				observation: ReadyAccountObservation
				owner: { subscribe(observer: { error: () => void }): { unsubscribe: () => void } }
			}
		>(({ input, receive, sendBack }) => {
			const native = required(input.host.adopt)(input.observation)
			let released = false
			const binding: AccountBinding = {
				observation: native.observation,
				release: () => {
					if (!released) {
						released = true
						native.release()
					}
				}
			}
			const subscription = input.owner.subscribe({ error: binding.release })
			let adopted = false
			receive(() => {
				adopted = true
				sendBack({ type: 'LIBRARY_ADOPTED' })
			})
			sendBack({ type: 'LIBRARY_BOUND', binding })
			return () => {
				subscription.unsubscribe()
				if (!adopted) binding.release()
			}
		}),
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
			run: ({ input }: { input: { host: AccountHost; observation: ReadyAccountObservation } }) =>
				(input.observation.prepare ?? required(input.host.prepare))()
		}),
		create: createAsyncLogic({ run: ({ input }: { input: AccountHost }) => input.create() }),
		logout: signOutMachine,
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
				LIBRARY_BOUND: types<EventPayload<Event<Session>, 'LIBRARY_BOUND'>>(),
				LIBRARY_ADOPTED: types(),
				SIGN_OUT_OVERDUE: types<{ stage: SignOutStage }>(),
				RETRY: types<EventPayload<Event<Session>, 'RETRY'>>(),
				SHUTDOWN: types<EventPayload<Event<Session>, 'SHUTDOWN'>>(),
				CREATE: types<EventPayload<Event<Session>, 'CREATE'>>(),
				LOGOUT: types<EventPayload<Event<Session>, 'LOGOUT'>>(),
				RESTORE: types<EventPayload<Event<Session>, 'RESTORE'>>(),
				RESTORATION_VALIDATED: types<EventPayload<Event<Session>, 'RESTORATION_VALIDATED'>>(),
				RESTORATION_PREPARE_REQUESTED:
					types<EventPayload<Event<Session>, 'RESTORATION_PREPARE_REQUESTED'>>(),
				SESSION_ACQUIRED: types<EventPayload<Event<Session>, 'SESSION_ACQUIRED'>>()
			},
			internalEvents: {
				OBSERVATION_RESTARTED: types<EventPayload<Event<Session>, 'OBSERVATION_RESTARTED'>>(),
				STARTUP_CLOSED: types<EventPayload<Event<Session>, 'STARTUP_CLOSED'>>(),
				FEEDBACK_CLEAR: types<EventPayload<Event<Session>, 'FEEDBACK_CLEAR'>>(),
				IDENTITY_FAILED: types<EventPayload<Event<Session>, 'IDENTITY_FAILED'>>(),
				RESTORE_INVALID: types<EventPayload<Event<Session>, 'RESTORE_INVALID'>>(),
				RESTORE_FAILED: types<EventPayload<Event<Session>, 'RESTORE_FAILED'>>()
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
				bindingCustody: types<import('xstate').ActorRefFrom<typeof accountActors.bindingCustody>>(),
				libraryBinding: types<import('xstate').ActorRefFrom<typeof accountActors.libraryBinding>>(),
				prepare: types<import('xstate').ActorRefFrom<(typeof accountActors)['prepare']>>(),
				create: types<import('xstate').ActorRefFrom<(typeof accountActors)['create']>>(),
				logout: types<import('xstate').ActorRefFrom<(typeof accountActors)['logout']>>(),
				bootstrap: types<import('xstate').ActorRefFrom<(typeof accountActors)['bootstrap']>>(),
				global: types<import('xstate').ActorRefFrom<(typeof accountActors)['global']>>(),
				restore: types<import('xstate').ActorRefFrom<(typeof accountActors)['restore']>>()
			}
		},
		states: {
			active: {
				type: 'parallel',
				states: {
					connection: {
						states: {
							observing: {
								states: {
									checking: {},
									online: {},
									offline: {}
								}
							},
							closed: {}
						}
					},
					feedback: {
						states: {
							none: {},
							identityFailed: {},
							restoreInvalid: {},
							restoreFailed: {}
						}
					},
					flow: {
						id: 'application-flow',
						states: {
							opening: {},
							openFailed: {},
							binding: {
								schemas: { input: types<{ session: Session }>() },
								states: {
									waiting: {},
									adopting: {
										schemas: {
											context: types<{ host: AccountHost; readinessScope: SessionReadinessScope }>()
										}
									},
									stopping: {}
								}
							},
							running: {
								id: 'application-active-flow-running',
								schemas: {
									context: types<{ host: AccountHost; readinessScope: SessionReadinessScope }>()
								},
								states: {
									draining: { id: 'application-active-flow-running-draining' },
									refreshing: {},
									route: { id: 'application-active-flow-running-route' },
									adoptingLibrary: {
										schemas: {
											input: types<{ candidate: ReadyAccountObservation }>(),
											context: types<{ candidate: ReadyAccountObservation }>()
										},
										states: { waiting: {}, accepting: {}, stopping: {} }
									},
									preparing: {
										schemas: {
											context: types<{ preparing: AccountBindingIdentity }>()
										},
										states: {
											active: {},
											stopping: {}
										}
									},
									signedOut: {},
									waiting: {},
									unavailable: {},
									retrying: { id: 'application-active-flow-running-retrying' },
									reobserving: {},
									creating: {
										states: {
											active: {},
											stopping: {}
										}
									},
									restoring: {
										id: 'application-active-flow-running-restoring',
										states: {
											active: {},
											stopping: {}
										}
									},
									loggingOut: {
										id: 'application-active-flow-running-loggingOut',
										states: { active: {}, overdue: {}, stopping: {} }
									},
									library: {
										id: 'application-active-flow-running-library',
										states: {
											bootstrapping: {},
											stopping: {},
											replacing: {},
											conflict: {},
											failed: {},
											ready: {
												states: {
													existing: {},
													stopping: {
														states: {
															shutdown: {},
															restore: {},
															logout: {},
															replace: {}
														}
													},
													syncPending: {},
													synced: {},
													syncFailed: {}
												}
											}
										}
									}
								}
							},
							closing: { id: 'application-active-flow-closing' },
							finished: { type: 'choice' }
						}
					},
					ownerHealth: {
						states: {
							healthy: {},
							failed: {}
						}
					},
					cleanupHealth: {
						states: {
							healthy: {},
							failed: {}
						}
					},
					observationHealth: {
						states: {
							healthy: {},
							failed: {}
						}
					}
				}
			},
			cleanupFailed: { id: 'application-cleanupFailed', type: 'final' },
			ownerFailed: { id: 'application-ownerFailed', type: 'final' },
			closed: { id: 'application-closed', type: 'final' }
		},
		actors: accountActors,
		guards: {
			libraryStoppingFor: (
				{ value }: { value: import('xstate').StateValue },
				reason: 'restore' | 'logout' | 'replace'
			) =>
				matchesState(
					{ active: { flow: { running: { library: { ready: { stopping: reason } } } } } },
					value
				),
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
			preparationReplaced: (
				{ context }: { context: Context<Session> },
				preparing: AccountBindingIdentity
			) =>
				context.observation.status === 'ready' &&
				!sameAccountBinding(context.observation, preparing) &&
				(context.observation.localFirst !== false ||
					context.observation.accountId !== preparing.accountId ||
					context.observation.clientBinding !== preparing.clientBinding ||
					context.observation.databaseBinding !== preparing.databaseBinding),
			needsLocalFirst: ({ context }) =>
				context.observation.status === 'ready' &&
				context.observation.localFirst === false &&
				!!(context.observation.prepare ?? context.host?.prepare),
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
				sameAccountBinding(event.observation, context.observation) &&
				event.observation.localFirst === context.observation.localFirst
		},
		actions: {
			refreshBinding: ({ context, event }: { context: Context<Session>; event: Event<Session> }) =>
				event.type === 'OBSERVED' &&
				event.observation.status === 'ready' &&
				context.observation.status === 'ready'
					? {
							context: {
								observation: {
									...event.observation,
									...context.observation,
									...(event.observation.signedIn === undefined
										? {}
										: { signedIn: event.observation.signedIn })
								}
							}
						}
					: { context: {} },
			clearPhrase: () => ({ context: { phrase: '' } }),
			clearResources: (): {
				context: Pick<
					Context<Session>,
					'host' | 'write' | 'observation' | 'phrase' | 'adoption' | 'candidate' | 'failedBinding'
				>
			} => ({
				context: {
					host: undefined,
					write: undefined,
					observation: { status: 'closed' },
					adoption: undefined,
					candidate: undefined,
					failedBinding: undefined,
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
			input,
			scope: input.startup.scope,
			readinessScope: undefined,
			retryAttempt: 0,
			observationAttempt: 0,
			host: undefined,
			observation: { status: 'signed-out' },
			adoption: undefined,
			candidate: undefined,
			failedBinding: undefined,
			write: undefined,
			phrase: '',
			attempt: 0
		}),

		entry: (args, enq) => {
			enq.sendTo('startup', { type: 'START', ...args.context.input.startup })
		},
		invoke: [
			{ id: 'bindingCustody', src: 'bindingCustody', input: ({ self }) => ({ owner: self }) },
			{
				id: 'startup',
				src: 'startup',
				input: ({ self }) => ({ reportTo: self }),
				onDone: (args, enq) => {
					enq.raise({ type: 'STARTUP_CLOSED' })
				}
			}
		],
		states: {
			active: {
				type: 'parallel',
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
											variant: 'info',
											channel: 'connection'
										}
									},
									offline: {
										meta: {
											name: t('connection.offline'),
											variant: 'info',
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
									variant: 'error'
								}
							},
							restoreInvalid: {
								meta: {
									channel: 'feedback',
									feedback: 'restoreInvalid',
									name: t('account.feedback.restoreInvalid'),
									variant: 'error'
								}
							},
							restoreFailed: {
								meta: {
									channel: 'feedback',
									feedback: 'restoreFailed',
									name: t('account.feedback.restoreFailed'),
									variant: 'error'
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
									input: { session: args.event.session }
								}
							},
							SESSION_STARTUP_FAILED: (args, enq) => {
								if (args.guards.failedOwner(args)) {
									enq.raise({ type: 'SHUTDOWN' })
									return {}
								}
								if (args.guards.currentStartup(args)) {
									return { target: '.openFailed' }
								}
							},
							SESSION_OBSERVATION_CLEANUP_FAILED: (args, enq) => {
								if (!args.guards.currentReadinessScope(args)) return
								enq.raise({ type: 'SHUTDOWN' })
							},
							SHUTDOWN: { target: '.closing' }
						},
						states: {
							opening: { meta: accountStatus('starting', t('account.status.starting')) },
							openFailed: {
								meta: accountStatus('unavailable', t('account.status.unavailable')),
								on: {
									RETRY: (args, enq) => {
										enq.sendTo('startup', { type: 'RETRY' })
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
									input: ({ context, input }) => ({
										session: input.session,
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
										on: { HOST_ADOPTED: { target: '#application-active-flow-running' } }
									},
									stopping: {
										on: {
											HOST_BOUND: {
												target: '#application-active-flow-closing'
											},
											HOST_ADOPTED: { target: '#application-active-flow-closing' }
										}
									}
								}
							},
							running: {
								id: 'application-active-flow-running',
								initial: 'route',

								entry: (args, enq) => {
									const { context } = args
									enq.sendTo('readiness', {
										type: 'BIND',
										scope: context.readinessScope,
										capability: context.host.readiness.capability
									})
								},
								invoke: [
									{
										id: 'readiness',
										src: 'readiness',
										input: ({ self }) => ({ reportTo: self }),
										onDone: { target: '#application-active-flow-closing' }
									},
									{
										id: 'observation',
										src: 'observation',
										input: ({ context }) => context.host
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
											type: 'OBSERVED',
											observation: { status: 'error' }
										})
									}
								},
								states: {
									draining: {
										id: 'application-active-flow-running-draining',
										meta: accountStatus('closing', t('account.status.closing')),
										entry: (args, enq) => {
											enq.sendTo('readiness', { type: 'SHUTDOWN' })
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
										id: 'application-active-flow-running-route',
										entry: () => {
											return { context: { write: undefined } }
										},
										always: (args, enq) => {
											const { context } = args
											if (matchesState({ active: { observationHealth: 'failed' } }, args.value)) {
												return {
													target: 'unavailable',
													context: { observation: { status: 'error' } }
												}
											}
											if (args.guards.needsLocalFirst(args)) {
												if (context.observation.status !== 'ready')
													throw new Error('Preparation scope unavailable')
												return {
													target: 'preparing',
													context: {
														preparing: accountBindingIdentity(context.observation)
													}
												}
											}
											if (context.observation.status === 'ready') {
												if (
													context.host.adopt &&
													(!context.adoption ||
														!sameAccountBinding(context.observation, context.adoption.observation))
												)
													return {
														target: 'adoptingLibrary',
														context: { candidate: context.observation },
														input: { candidate: context.observation }
													}
												return {
													target: 'library',
													context: {
														observation: context.adoption
															? {
																	...context.adoption.observation,
																	...(context.observation.localFirst === undefined
																		? {}
																		: { localFirst: context.observation.localFirst }),
																	...(context.observation.signedIn === undefined
																		? {}
																		: { signedIn: context.observation.signedIn })
																}
															: context.observation
													}
												}
											}
											if (context.adoption)
												enq.sendTo('bindingCustody', { type: 'RELEASE', binding: context.adoption })
											if (context.observation.status === 'signed-out') {
												return { target: 'signedOut', context: { adoption: undefined } }
											}
											if (context.observation.status === 'transitioning') {
												return { target: 'waiting', context: { adoption: undefined } }
											}
											return { target: 'unavailable', context: { adoption: undefined } }
										}
									},
									adoptingLibrary: {
										initial: 'waiting',
										entry: ({ context, input }, enq) => {
											if (context.adoption)
												enq.sendTo('bindingCustody', { type: 'RELEASE', binding: context.adoption })
											return { context: { adoption: undefined, candidate: input.candidate } }
										},
										invoke: {
											id: 'libraryBinding',
											src: 'libraryBinding',
											input: ({ context, input, self }) => ({
												owner: self,
												host: context.host,
												observation: input.candidate
											}),
											onError: ({ context }) =>
												sameAccountBinding(context.observation, context.candidate)
													? {
															target: 'unavailable',
															context: {
																observation: { status: 'error' },
																failedBinding: accountBindingIdentity(context.candidate),
																candidate: undefined
															}
														}
													: { target: 'route' }
										},
										on: { SHUTDOWN: { target: '.stopping' } },
										states: {
											waiting: {
												on: {
													LIBRARY_BOUND: ({ context, event }, enq) => {
														if (!sameAccountBinding(context.observation, event.binding.observation))
															return { target: '#application-active-flow-running-route' }
														enq.sendTo('bindingCustody', { type: 'OWN', binding: event.binding })
														return { target: 'accepting', context: { adoption: event.binding } }
													}
												}
											},
											accepting: {
												entry: (_, enq) => enq.sendTo('libraryBinding', { type: 'ADOPT' }),
												on: {
													LIBRARY_ADOPTED: ({ context }) =>
														sameAccountBinding(
															context.observation,
															required(context.adoption).observation
														)
															? {
																	target: '#application-active-flow-running-library',
																	context: {
																		observation: required(context.adoption).observation,
																		candidate: undefined
																	}
																}
															: { target: '#application-active-flow-running-route' }
												}
											},
											stopping: {
												on: {
													LIBRARY_BOUND: { target: '#application-active-flow-running-draining' },
													LIBRARY_ADOPTED: { target: '#application-active-flow-running-draining' }
												}
											}
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
											input: ({ context }) => {
												if (context.observation.status !== 'ready')
													throw new Error('Account scope unavailable')
												return { host: context.host, observation: context.observation }
											},
											onDone: (args, _enq) => {
												if (args.guards.stoppingPreparation(args)) {
													return { target: 'draining' }
												}

												return { target: 'refreshing' }
											},
											onError: (args) => {
												if (args.guards.stoppingPreparation(args)) {
													return { target: 'draining' }
												}
												if (args.guards.preparationReplaced(args, args.context.preparing))
													return { target: 'refreshing' }
												return {
													target: 'unavailable',
													context: {
														observation: { status: 'error' },
														failedBinding: args.context.preparing
													}
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
												enq.raise({ type: 'FEEDBACK_CLEAR' })
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
													return { target: 'reobserving', context: { failedBinding: undefined } }
												}
												return { target: 'retrying', context: { failedBinding: undefined } }
											},
											OBSERVED: (args) => {
												if (
													args.context.failedBinding &&
													sameAccountBinding(args.context.failedBinding, args.event.observation)
												)
													return
												return {
													target: 'route',
													context: args.actions.rememberObservation(args).context
												}
											}
										}
									},

									retrying: {
										id: 'application-active-flow-running-retrying',
										entry: (args, enq) => {
											const { context } = args
											const retryAttempt = context.retryAttempt + 1
											enq.sendTo('readiness', {
												type: 'RETRY',
												scope: context.readinessScope,
												attempt: retryAttempt
											})
											return { context: { retryAttempt } }
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
											const { context } = args
											const observationAttempt = context.observationAttempt + 1
											enq.raise({ type: 'OBSERVATION_RESTARTED' })
											enq.sendTo('readiness', {
												type: 'REOBSERVE',
												scope: context.readinessScope,
												observation: observationAttempt
											})
											return { context: { observationAttempt } }
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
											enq.raise({ type: 'FEEDBACK_CLEAR' })
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
											input: ({ context }) => context.host,
											onDone: (args, _enq) => {
												if (args.guards.stoppingCreate(args)) {
													return {
														target: '#application-active-flow-running-draining'
													}
												}

												return { target: 'refreshing' }
											},
											onError: (args, enq) => {
												if (args.guards.stoppingCreate(args)) {
													return {
														target: '#application-active-flow-running-draining'
													}
												}
												enq.raise({ type: 'IDENTITY_FAILED' })

												return { target: 'refreshing' }
											}
										}
									},
									restoring: {
										id: 'application-active-flow-running-restoring',
										entry: (args, enq) => {
											enq.raise({ type: 'FEEDBACK_CLEAR' })
										},
										initial: 'active',
										states: {
											active: {},
											stopping: { meta: accountStatus('closing', t('account.status.closing')) }
										},
										on: {
											SHUTDOWN: (args, enq) => {
												enq.sendTo('restore', { type: 'SHUTDOWN' })
												return { target: '.stopping', context: args.actions.clearPhrase().context }
											},
											RESTORATION_VALIDATED: (args) => {
												return { context: args.actions.clearPhrase().context }
											},
											RESTORATION_PREPARE_REQUESTED: (args, enq) => {
												const { event } = args
												enq.sendTo('restore', {
													type: 'PREPARED',
													binding: event.binding,
													attempt: event.attempt
												})
											}
										},
										invoke: {
											id: 'restore',
											src: 'restore',
											input: ({ context, self }) => ({
												capability: context.host.restoration.capability,
												scope: {
													binding: context.host.restoration.binding,
													attempt: context.attempt
												},
												phrase: context.phrase,
												reportTo: self
											}),
											onDone: (args, enq) => {
												const patch = args.actions.clearPhrase().context
												if (args.guards.stoppingRestore(args))
													return {
														target: '#application-active-flow-running-draining',
														context: patch
													}
												if (isRestored(args.event.output)) enq.raise({ type: 'FEEDBACK_CLEAR' })
												else if (isInvalidRestoration(args.event.output))
													enq.raise({ type: 'RESTORE_INVALID' })
												else enq.raise({ type: 'RESTORE_FAILED' })
												return { target: 'refreshing', context: patch }
											},
											onError: (args, enq) => {
												const patch = args.actions.clearPhrase().context
												if (args.guards.stoppingRestore(args))
													return {
														target: '#application-active-flow-running-draining',
														context: patch
													}
												enq.raise({ type: 'RESTORE_FAILED' })
												return { target: 'refreshing', context: patch }
											}
										}
									},
									loggingOut: {
										id: 'application-active-flow-running-loggingOut',
										initial: 'active',
										states: {
											active: {
												on: {
													SIGN_OUT_OVERDUE: (_args, enq) => {
														enq.raise({ type: 'IDENTITY_FAILED' })
														return { target: 'overdue' }
													}
												}
											},
											overdue: {
												meta: {
													...accountStatus('working', t('account.feedback.identityFailed')),
													variant: 'error'
												}
											},
											stopping: { meta: accountStatus('closing', t('account.status.closing')) }
										},
										on: {
											SHUTDOWN: { target: '.stopping' },
											SIGN_OUT_OVERDUE: (_args, enq) => {
												enq.raise({ type: 'IDENTITY_FAILED' })
											}
										},
										invoke: {
											id: 'logout',
											src: 'logout',
											input: ({ context, self }) =>
												signOutInput(context.host, context.observation, (stage) =>
													self.send({ type: 'SIGN_OUT_OVERDUE', stage })
												),
											onDone: (args, enq) => {
												if (args.event.output.outcome === 'failed')
													enq.raise({ type: 'IDENTITY_FAILED' })
												return args.guards.stoppingLogout(args)
													? { target: '#application-active-flow-running-draining' }
													: { target: 'refreshing' }
											},
											onError: (args, enq) => {
												enq.raise({ type: 'IDENTITY_FAILED' })
												return args.guards.stoppingLogout(args)
													? { target: '#application-active-flow-running-draining' }
													: { target: 'refreshing' }
											}
										}
									},

									library: {
										id: 'application-active-flow-running-library',
										initial: 'bootstrapping',
										invoke: {
											id: 'bootstrap',
											src: 'bootstrap',
											input: ({ context }) => root(context),
											onDone: (args) => {
												const { event } = args
												if (args.guards.stoppingBootstrap(args)) {
													return { target: '#application-active-flow-running-draining' }
												}
												if (args.guards.replacingBootstrap(args)) {
													return { target: '#application-active-flow-running-route' }
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
													return args.actions.refreshBinding(args)
												}
												return {
													target: '#application-active-flow-running-route',
													context: args.actions.rememberObservation(args).context
												}
											}
										},
										states: {
											bootstrapping: {
												meta: accountStatus('openingLibrary', t('account.status.openingLibrary')),
												on: {
													SHUTDOWN: (args, enq) => {
														enq.sendTo('bootstrap', { type: 'SHUTDOWN' })
														return { target: 'stopping' }
													},
													OBSERVED: (args, enq) => {
														if (args.guards.sameBinding(args)) {
															return args.actions.refreshBinding(args)
														}
														enq.sendTo('bootstrap', { type: 'SHUTDOWN' })
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
														target: '#application-active-flow-running-loggingOut'
													}
												}
											},
											failed: {
												meta: accountStatus('rootFailed', t('account.status.rootFailed')),
												on: {
													RETRY: {
														target: '#application-active-flow-running-retrying'
													},
													LOGOUT: {
														target: '#application-active-flow-running-loggingOut'
													}
												}
											},
											ready: {
												initial: 'syncPending',
												invoke: {
													id: 'library',
													src: 'library',
													input: ({ context }) =>
														context.observation.status === 'ready'
															? context.observation.library
															: undefined,
													onDone: (args) => {
														if (args.guards.libraryStoppingFor(args, 'restore'))
															return { target: '#application-active-flow-running-restoring' }
														if (args.guards.libraryStoppingFor(args, 'logout'))
															return { target: '#application-active-flow-running-loggingOut' }
														if (args.guards.libraryStoppingFor(args, 'replace'))
															return { target: '#application-active-flow-running-route' }
														return { target: '#application-active-flow-running-draining' }
													}
												},
												on: {
													RESTORE: (args, enq) => {
														enq.raise({ type: 'FEEDBACK_CLEAR' })
														enq.sendTo('library', { type: 'SHUTDOWN' })
														return {
															target: '.stopping.restore',
															context: {
																phrase: args.event.phrase,
																attempt: args.context.attempt + 1
															}
														}
													},
													LOGOUT: (args, enq) => {
														enq.sendTo('library', { type: 'SHUTDOWN' })
														return { target: '.stopping.logout' }
													},
													SHUTDOWN: (args, enq) => {
														enq.sendTo('library', { type: 'SHUTDOWN' })
														return { target: '.stopping.shutdown' }
													},
													OBSERVED: (args, enq) => {
														if (args.guards.sameBinding(args)) {
															return args.actions.refreshBinding(args)
														}
														enq.sendTo('library', { type: 'SHUTDOWN' })
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
															input: ({ context }) => required(context.write),
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
								id: 'application-active-flow-closing',
								meta: accountStatus('closing', t('account.status.closing')),
								entry: (args, enq) => {
									const { context } = args
									if (context.adoption)
										enq.sendTo('bindingCustody', { type: 'RELEASE', binding: context.adoption })
									enq(() => context.host?.release())
									enq.sendTo('startup', { type: 'SHUTDOWN' })
									return {
										context: {
											...args.actions.clearPhrase().context,
											adoption: undefined,
											candidate: undefined,
											failedBinding: undefined
										}
									}
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
										return { target: '#application-cleanupFailed' }
									}
									if (matchesState({ active: { ownerHealth: 'failed' } }, args.value)) {
										return { target: '#application-ownerFailed' }
									}
									return { target: '#application-closed' }
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
				id: 'application-cleanupFailed',
				meta: accountStatus('cleanupFailed', t('account.status.cleanupFailed')),
				type: 'final',
				entry: (args) => {
					return { context: args.actions.clearResources().context }
				}
			},
			ownerFailed: {
				id: 'application-ownerFailed',
				meta: accountStatus('ownerFailed', t('account.status.ownerFailed')),
				type: 'final',
				entry: (args) => {
					return { context: args.actions.clearResources().context }
				}
			},
			closed: {
				id: 'application-closed',
				meta: accountStatus('closed', t('account.status.closed')),
				type: 'final',
				entry: () => {
					return {
						context: {
							host: undefined,
							write: undefined,
							clean: true,
							adoption: undefined,
							candidate: undefined,
							failedBinding: undefined,
							observation: { status: 'closed' },
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
		showIdentityForm: snapshot?.can({ type: 'CREATE' }) ?? false,
		canLogout:
			snapshot?.context.observation.status === 'ready' &&
			snapshot.context.observation.signedIn === true &&
			snapshot.can({ type: 'LOGOUT' }),
		canRestore: snapshot?.can({ type: 'RESTORE', phrase: '' }) ?? false,
		canRetry: snapshot?.can({ type: 'RETRY' }) ?? false,
		requiresReload:
			snapshot?.matches('ownerFailed') ||
			snapshot?.matches('cleanupFailed') ||
			snapshot?.matches({ active: { flow: { running: { loggingOut: 'overdue' } } } }) ||
			false
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
