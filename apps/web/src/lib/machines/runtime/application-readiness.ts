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
import type { SnapshotFrom } from 'xstate'
import { assign, fromPromise, raise, sendTo, setup, stateIn } from 'xstate'
import { restorationMachine } from 'delightful-local-first/restoration/workflow'
import type { RestorationReport } from 'delightful-local-first/restoration/contracts'
import type {
	AccountHost,
	AccountInput,
	AccountObservation,
	RootAccess,
	RootWrite
} from '../../contracts/account.js'

type Event<Session extends object> =
	| SessionStartupReport<Session>
	| SessionReadinessReport
	| { type: 'OBSERVED'; observation: AccountObservation }
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

export function createApplicationReadinessMachine<Session extends object>() {
	const accountActors = {
		library: libraryMachine,
		startup: createSessionStartupMachine<Session>(),
		readiness: createSessionReadinessMachine(),
		create: fromPromise(({ input }: { input: AccountHost }) => input.create()),
		logout: fromPromise(({ input }: { input: AccountHost }) => input.logout()),
		bootstrap: rootBootstrapMachine,
		global: fromPromise(({ input }: { input: RootWrite }) => input.global()),
		restore: restorationMachine
	}

	const model = setup<
		Context<Session>,
		Event<Session>,
		typeof accountActors,
		{
			startup: 'startup'
			readiness: 'readiness'
			bootstrap: 'bootstrap'
			restore: 'restore'
			library: 'library'
		},
		{
			refresh: undefined
			clearPhrase: undefined
			rememberObservation: undefined
			failedIdentity: undefined
			clearFeedback: undefined
			clearResources: undefined
		},
		{
			stoppingCreate: undefined
			stoppingRestore: undefined
			stoppingLogout: undefined
			stoppingBootstrap: undefined
			replacingBootstrap: undefined
			sameBinding: undefined
			currentStartup: undefined
			currentReadiness: undefined
			currentReadinessScope: undefined
			failedOwner: undefined
			observationBroken: undefined
			ownerBroken: undefined
			cleanupBroken: undefined
		},
		never,
		never,
		AccountInput<Session>,
		undefined,
		{ type: string },
		AccountMeta
	>({
		actors: accountActors,
		guards: {
			observationBroken: stateIn({ active: { observationHealth: 'failed' } }),
			ownerBroken: stateIn({ active: { ownerHealth: 'failed' } }),
			cleanupBroken: stateIn({ active: { cleanupHealth: 'failed' } }),
			failedOwner: ({ context, event }) =>
				event.type === 'SESSION_STARTUP_FAILED' &&
				event.reason === 'ownerFailed' &&
				event.scope.binding === context.scope.binding &&
				event.scope.attachment === context.scope.attachment &&
				event.scope.generation === context.scope.generation,
			currentReadinessScope: ({ context, event }) =>
				'scope' in event &&
				event.scope.binding === context.readinessScope?.binding &&
				event.scope.attachment === context.readinessScope?.attachment,

			currentStartup: ({ context, event }) =>
				'scope' in event &&
				'generation' in event.scope &&
				event.scope.binding === context.scope.binding &&
				event.scope.attachment === context.scope.attachment &&
				event.scope.generation === context.scope.generation,
			currentReadiness: ({ context, event }) =>
				'scope' in event &&
				event.scope.binding === context.readinessScope?.binding &&
				event.scope.attachment === context.readinessScope?.attachment &&
				'observation' in event &&
				event.observation === context.observationAttempt,

			stoppingCreate: stateIn('#application-flow.running.creating.stopping'),
			stoppingRestore: stateIn('#application-flow.running.restoring.stopping'),
			stoppingLogout: stateIn('#application-flow.running.loggingOut.stopping'),
			stoppingBootstrap: stateIn('#application-flow.running.library.stopping'),
			replacingBootstrap: stateIn('#application-flow.running.library.replacing'),
			sameBinding: ({ context, event }) =>
				event.type === 'OBSERVED' &&
				event.observation.status === 'ready' &&
				context.observation.status === 'ready' &&
				event.observation.binding === context.observation.binding
		},
		actions: {
			refresh: assign(({ context }) => ({
				observation: observe(required(context.host))
			})),
			clearPhrase: assign({ phrase: '' }),
			clearResources: assign({
				host: undefined,
				write: undefined,
				observation: { status: 'closed' },
				phrase: ''
			}),
			rememberObservation: assign(({ event }) =>
				event.type === 'OBSERVED' ? { observation: event.observation } : {}
			),
			failedIdentity: raise({ type: 'IDENTITY_FAILED' }),
			clearFeedback: raise({ type: 'FEEDBACK_CLEAR' })
		}
	})
	const flow = model.createStateConfig({
		id: 'application-flow',
		initial: 'opening',
		on: {
			STARTUP_CLOSED: '.finished',
			SESSION_STARTING: {
				actions: assign(({ context, event }) =>
					event.scope.binding === context.scope.binding &&
					event.scope.attachment === context.scope.attachment
						? { scope: event.scope }
						: {}
				)
			},
			SESSION_ACQUIRED: {
				guard: 'currentStartup',
				target: '.running',
				actions: assign(({ context, event }) => {
					const host = context.input.bind(event.session)
					return {
						host,
						readinessScope: { binding: host.readiness.binding, attachment: {} },
						observation: observe(host)
					}
				})
			},
			SESSION_STARTUP_FAILED: [
				{
					guard: 'failedOwner',
					actions: raise({ type: 'SHUTDOWN' })
				},
				{ guard: 'currentStartup', target: '.openFailed' }
			],
			SESSION_OBSERVATION_CLEANUP_FAILED: {
				guard: 'currentReadinessScope',
				actions: raise({ type: 'SHUTDOWN' })
			},
			SHUTDOWN: '.closing'
		},
		states: {
			opening: { meta: accountStatus('starting', t('account.status.starting')) },
			openFailed: {
				meta: accountStatus('unavailable', t('account.status.unavailable')),
				on: { RETRY: { target: 'opening', actions: sendTo('startup', { type: 'RETRY' }) } }
			},
			running: {
				initial: 'route',

				entry: sendTo('readiness', ({ context }) => ({
					type: 'BIND',
					scope: required(context.readinessScope),
					capability: required(context.host).readiness.capability
				})),
				invoke: {
					id: 'readiness',
					src: 'readiness',
					input: ({ self }) => ({ reportTo: self }),
					onDone: '#application-flow.closing'
				},
				on: {
					SHUTDOWN: '.draining',
					OBSERVED: { actions: 'rememberObservation' },
					SESSION_STATUS: {
						guard: 'currentReadiness',
						actions: raise(({ context }) => ({
							type: 'OBSERVED',
							observation: observe(required(context.host))
						}))
					},
					SESSION_OBSERVATION_FAILED: {
						guard: 'currentReadiness',
						actions: [raise({ type: 'OBSERVED', observation: { status: 'error' } })]
					}
				},
				states: {
					draining: {
						meta: accountStatus('closing', t('account.status.closing')),
						entry: sendTo('readiness', { type: 'SHUTDOWN' }),
						on: {
							OBSERVED: {},
							SHUTDOWN: {},
							SESSION_STATUS: {},
							SESSION_OBSERVATION_FAILED: {}
						}
					},
					route: {
						entry: assign({ write: undefined }),
						always: [
							{
								guard: 'observationBroken',
								target: 'unavailable',
								actions: assign({ observation: { status: 'error' } })
							},
							{
								guard: ({ context }) => context.observation.status === 'ready',
								target: 'library'
							},
							{
								guard: ({ context }) => context.observation.status === 'signed-out',
								target: 'signedOut'
							},
							{
								guard: ({ context }) => context.observation.status === 'transitioning',
								target: 'waiting'
							},
							{ target: 'unavailable' }
						]
					},
					signedOut: {
						meta: accountStatus('signedOut', t('account.status.signedOut')),
						on: {
							OBSERVED: { target: 'route', actions: 'rememberObservation' },
							CREATE: { target: 'creating', actions: 'clearFeedback' },
							RESTORE: {
								target: 'restoring',
								actions: assign(({ context, event }) => ({
									phrase: event.phrase,
									attempt: context.attempt + 1
								}))
							}
						}
					},
					waiting: {
						on: { OBSERVED: { target: 'route', actions: 'rememberObservation' } }
					},
					unavailable: {
						meta: accountStatus('unavailable', t('account.status.unavailable')),
						on: {
							RETRY: [
								{ guard: 'observationBroken', target: 'reobserving' },
								{ target: 'retrying' }
							],
							OBSERVED: { target: 'route', actions: 'rememberObservation' }
						}
					},

					retrying: {
						entry: [
							assign(({ context }) => ({ retryAttempt: context.retryAttempt + 1 })),
							sendTo('readiness', ({ context }) => ({
								type: 'RETRY',
								scope: required(context.readinessScope),
								attempt: context.retryAttempt
							}))
						],
						on: {
							SESSION_RETRY_SETTLED: {
								guard: ({ context, event }) =>
									event.scope.binding === context.readinessScope?.binding &&
									event.scope.attachment === context.readinessScope?.attachment &&
									event.attempt === context.retryAttempt,
								target: 'route',
								actions: 'refresh'
							}
						}
					},
					reobserving: {
						entry: [
							raise({ type: 'OBSERVATION_RESTARTED' }),
							assign(({ context }) => ({
								observationAttempt: context.observationAttempt + 1
							})),
							sendTo('readiness', ({ context }) => ({
								type: 'REOBSERVE',
								scope: required(context.readinessScope),
								observation: context.observationAttempt
							}))
						],
						on: { OBSERVED: { target: 'route', actions: 'rememberObservation' } }
					},
					creating: {
						entry: 'clearFeedback',
						initial: 'active',
						states: {
							active: {},
							stopping: { meta: accountStatus('closing', t('account.status.closing')) }
						},
						on: { SHUTDOWN: '.stopping' },
						invoke: {
							src: 'create',
							input: ({ context }) => required(context.host),
							onDone: [
								{ guard: 'stoppingCreate', target: '#application-flow.running.draining' },
								{ target: 'route', actions: 'refresh' }
							],
							onError: [
								{ guard: 'stoppingCreate', target: '#application-flow.running.draining' },
								{ target: 'route', actions: ['failedIdentity', 'refresh'] }
							]
						}
					},
					restoring: {
						entry: 'clearFeedback',
						initial: 'active',
						states: {
							active: {},
							stopping: { meta: accountStatus('closing', t('account.status.closing')) }
						},
						on: {
							SHUTDOWN: {
								target: '.stopping',
								actions: [sendTo('restore', { type: 'SHUTDOWN' }), 'clearPhrase']
							},
							RESTORATION_VALIDATED: { actions: 'clearPhrase' },
							RESTORATION_PREPARE_REQUESTED: {
								actions: sendTo('restore', ({ event }) => ({
									type: 'PREPARED',
									binding: event.binding,
									attempt: event.attempt
								}))
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
							onDone: [
								{
									guard: 'stoppingRestore',
									target: '#application-flow.running.draining',
									actions: 'clearPhrase'
								},
								{
									guard: ({ event }) => isRestored(event.output),
									target: 'route',
									actions: ['clearFeedback', 'clearPhrase', 'refresh']
								},
								{
									guard: ({ event }) => isInvalidRestoration(event.output),
									target: 'route',
									actions: [raise({ type: 'RESTORE_INVALID' }), 'clearPhrase', 'refresh']
								},
								{
									target: 'route',
									actions: [raise({ type: 'RESTORE_FAILED' }), 'clearPhrase', 'refresh']
								}
							],
							onError: [
								{
									guard: 'stoppingRestore',
									target: '#application-flow.running.draining',
									actions: 'clearPhrase'
								},
								{
									target: 'route',
									actions: [raise({ type: 'RESTORE_FAILED' }), 'clearPhrase', 'refresh']
								}
							]
						}
					},
					loggingOut: {
						initial: 'active',
						states: {
							active: {},
							stopping: { meta: accountStatus('closing', t('account.status.closing')) }
						},
						on: { SHUTDOWN: '.stopping' },
						invoke: {
							src: 'logout',
							input: ({ context }) => required(context.host),
							onDone: [
								{ guard: 'stoppingLogout', target: '#application-flow.running.draining' },
								{ target: 'route', actions: 'refresh' }
							],
							onError: [
								{ guard: 'stoppingLogout', target: '#application-flow.running.draining' },
								{ target: 'route', actions: ['failedIdentity', 'refresh'] }
							]
						}
					},

					library: {
						initial: 'bootstrapping',
						invoke: {
							id: 'bootstrap',
							src: 'bootstrap',
							input: ({ context }) => root(context),
							onDone: [
								{
									guard: 'stoppingBootstrap',
									target: '#application-flow.running.draining'
								},
								{ guard: 'replacingBootstrap', target: '#application-flow.running.route' },
								{
									guard: ({ event }) => event.output.outcome === 'ready',
									target: '.ready',
									actions: assign({
										write: ({ event }) =>
											event.output.outcome === 'ready' ? event.output.write : undefined
									})
								},
								{
									guard: ({ event }) => event.output.outcome === 'conflict',
									target: '.conflict'
								},
								{ target: '.failed' }
							]
						},
						on: {
							OBSERVED: [
								{ guard: 'sameBinding' },
								{
									target: '#application-flow.running.route',
									actions: 'rememberObservation'
								}
							]
						},
						states: {
							bootstrapping: {
								meta: accountStatus('openingLibrary', t('account.status.openingLibrary')),
								on: {
									SHUTDOWN: {
										target: 'stopping',
										actions: sendTo('bootstrap', { type: 'SHUTDOWN' })
									},
									OBSERVED: [
										{ guard: 'sameBinding' },
										{
											target: 'replacing',
											actions: ['rememberObservation', sendTo('bootstrap', { type: 'SHUTDOWN' })]
										}
									]
								}
							},
							stopping: {
								meta: accountStatus('closing', t('account.status.closing')),
								on: { SHUTDOWN: {}, OBSERVED: { actions: 'rememberObservation' } }
							},
							replacing: {
								meta: accountStatus('openingLibrary', t('account.status.openingLibrary')),
								on: { OBSERVED: { actions: 'rememberObservation' }, SHUTDOWN: 'stopping' }
							},
							conflict: {
								meta: accountStatus('conflict', t('account.status.conflict')),
								on: { LOGOUT: '#application-flow.running.loggingOut' }
							},
							failed: {
								meta: accountStatus('rootFailed', t('account.status.rootFailed')),
								on: {
									RETRY: { target: '#application-flow.running.library', reenter: true },
									LOGOUT: '#application-flow.running.loggingOut'
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
									onDone: [
										{
											guard: stateIn('#application-flow.running.library.ready.stopping.restore'),
											target: '#application-flow.running.restoring'
										},
										{
											guard: stateIn('#application-flow.running.library.ready.stopping.logout'),
											target: '#application-flow.running.loggingOut'
										},
										{
											guard: stateIn('#application-flow.running.library.ready.stopping.replace'),
											target: '#application-flow.running.route'
										},
										{ target: '#application-flow.running.draining' }
									]
								},
								on: {
									RESTORE: {
										target: '.stopping.restore',
										actions: [
											assign(({ context, event }) => ({
												phrase: event.phrase,
												attempt: context.attempt + 1
											})),
											'clearFeedback',
											sendTo('library', { type: 'SHUTDOWN' })
										]
									},
									LOGOUT: {
										target: '.stopping.logout',
										actions: [sendTo('library', { type: 'SHUTDOWN' })]
									},
									SHUTDOWN: {
										target: '.stopping.shutdown',
										actions: [sendTo('library', { type: 'SHUTDOWN' })]
									},
									OBSERVED: [
										{ guard: 'sameBinding' },
										{
											target: '.stopping.replace',
											actions: ['rememberObservation', sendTo('library', { type: 'SHUTDOWN' })]
										}
									]
								},
								states: {
									stopping: {
										initial: 'shutdown',
										states: { shutdown: {}, restore: {}, logout: {}, replace: {} },
										meta: accountStatus('closing', t('account.status.closing')),
										on: {
											LOGOUT: {},
											RESTORE: {},
											SHUTDOWN: '.shutdown',
											OBSERVED: { actions: 'rememberObservation' }
										}
									},
									syncPending: {
										meta: accountStatus('localSaved', t('account.status.localSaved')),
										invoke: {
											src: 'global',
											input: ({ context }) => required(context.write),
											onDone: 'synced',
											onError: 'syncFailed'
										}
									},
									synced: { meta: accountStatus('synced', t('account.status.synced')) },
									syncFailed: {
										meta: accountStatus('syncFailed', t('account.status.syncFailed')),
										on: {
											RETRY: 'syncPending'
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
				entry: [
					'clearPhrase',
					({ context }) => context.host?.release(),
					sendTo('startup', { type: 'SHUTDOWN' })
				],
				on: {
					SESSION_ACQUIRED: {},
					SESSION_STARTUP_FAILED: {},
					SESSION_STARTING: {},
					SHUTDOWN: {}
				}
			},
			finished: {
				always: [
					{ guard: 'cleanupBroken', target: '#application-readiness.cleanupFailed' },
					{ guard: 'ownerBroken', target: '#application-readiness.ownerFailed' },
					{ target: '#application-readiness.closed' }
				]
			}
		}
	})
	return model.createMachine({
		id: 'application-readiness',
		initial: 'active',
		context: ({ input }) => ({
			input,
			scope: input.startup.scope,
			readinessScope: undefined,
			retryAttempt: 0,
			observationAttempt: 0,
			host: undefined,
			observation: { status: 'signed-out' },
			write: undefined,
			phrase: '',
			attempt: 0
		}),

		entry: sendTo('startup', ({ context }) => ({ type: 'START', ...context.input.startup })),
		invoke: {
			id: 'startup',
			src: 'startup',
			input: ({ self }) => ({ reportTo: self }),
			onDone: { actions: raise({ type: 'STARTUP_CLOSED' }) }
		},
		states: {
			active: {
				type: 'parallel',
				states: {
					feedback: {
						initial: 'none',
						on: {
							FEEDBACK_CLEAR: '.none',
							IDENTITY_FAILED: '.identityFailed',
							RESTORE_INVALID: '.restoreInvalid',
							RESTORE_FAILED: '.restoreFailed'
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
					flow,
					ownerHealth: {
						initial: 'healthy',
						states: {
							healthy: {
								on: { SESSION_STARTUP_FAILED: { guard: 'failedOwner', target: 'failed' } }
							},
							failed: {}
						}
					},
					cleanupHealth: {
						initial: 'healthy',
						states: {
							healthy: {
								on: {
									SESSION_OBSERVATION_CLEANUP_FAILED: {
										guard: 'currentReadinessScope',
										target: 'failed'
									}
								}
							},
							failed: {}
						}
					},
					observationHealth: {
						initial: 'healthy',
						on: { OBSERVATION_RESTARTED: '.healthy' },
						states: {
							healthy: {
								on: { SESSION_OBSERVATION_FAILED: { guard: 'currentReadiness', target: 'failed' } }
							},
							failed: {}
						}
					}
				}
			},
			cleanupFailed: {
				meta: accountStatus('cleanupFailed', t('account.status.cleanupFailed')),
				type: 'final',
				entry: 'clearResources'
			},
			ownerFailed: {
				meta: accountStatus('ownerFailed', t('account.status.ownerFailed')),
				type: 'final',
				entry: 'clearResources'
			},
			closed: {
				meta: accountStatus('closed', t('account.status.closed')),
				type: 'final',
				entry: assign({
					host: undefined,
					write: undefined,
					observation: { status: 'closed' },
					phrase: ''
				})
			}
		}
	})
}

export type ApplicationStatus =
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
		feedback,
		showIdentityForm: snapshot?.can({ type: 'CREATE' }) ?? false,
		canLogout:
			snapshot?.context.observation.status === 'ready' &&
			snapshot.context.observation.signedIn === true &&
			snapshot.can({ type: 'LOGOUT' }),
		canRestore: snapshot?.can({ type: 'RESTORE', phrase: '' }) ?? false,
		canRetry: snapshot?.can({ type: 'RETRY' }) ?? false,
		requiresReload: snapshot?.matches('ownerFailed') || snapshot?.matches('cleanupFailed') || false
	}
}
export function selectRecoveryBinding<Session extends object>(
	snapshot: ApplicationSnapshot<Session> | undefined
) {
	return snapshot?.matches({ active: { flow: { running: 'library' } } }) &&
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
