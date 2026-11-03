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

type Context<Session extends object> = {
	host: AccountHost | undefined
	input: AccountInput<Session>
	scope: AccountInput<Session>['startup']['scope']
	readinessScope: SessionReadinessScope | undefined
	retryAttempt: number
	observationAttempt: number
	observationFailed: boolean
	ownerFailed: boolean
	cleanupFailed: boolean
	observation: AccountObservation
	write: RootWrite | undefined
	phrase: string
	attempt: number
	productExit: 'logout' | 'shutdown' | 'replace' | 'restore'
	feedback: 'none' | 'identityFailed' | 'restoreFailed' | 'restoreInvalid'
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

	return setup<
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
		},
		never,
		never,
		AccountInput<Session>,
		undefined,
		{ type: string },
		{ status: MachineStatus }
	>({
		actors: accountActors,
		guards: {
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

			stoppingCreate: stateIn({ running: { creating: 'stopping' } }),
			stoppingRestore: stateIn({ running: { restoring: 'stopping' } }),
			stoppingLogout: stateIn({ running: { loggingOut: 'stopping' } }),
			stoppingBootstrap: stateIn({ running: { library: 'stopping' } }),
			replacingBootstrap: stateIn({ running: { library: 'replacing' } }),
			sameBinding: ({ context, event }) =>
				event.type === 'OBSERVED' &&
				event.observation.status === 'ready' &&
				context.observation.status === 'ready' &&
				event.observation.binding === context.observation.binding
		},
		actions: {
			refresh: assign(({ context }) => ({
				observation: context.observationFailed
					? { status: 'error' }
					: observe(required(context.host))
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
			failedIdentity: assign({ feedback: 'identityFailed' })
		}
	}).createMachine({
		id: 'application-readiness',
		initial: 'opening',
		context: ({ input }) => ({
			input,
			scope: input.startup.scope,
			readinessScope: undefined,
			retryAttempt: 0,
			observationAttempt: 0,
			observationFailed: false,
			ownerFailed: false,
			cleanupFailed: false,
			host: undefined,
			observation: { status: 'signed-out' },
			write: undefined,
			phrase: '',
			attempt: 0,
			feedback: 'none',
			productExit: 'shutdown'
		}),

		entry: sendTo('startup', ({ context }) => ({ type: 'START', ...context.input.startup })),
		invoke: {
			id: 'startup',
			src: 'startup',
			input: ({ self }) => ({ reportTo: self }),
			onDone: '#application-readiness.finished'
		},
		on: {
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
					actions: [assign({ ownerFailed: true }), raise({ type: 'SHUTDOWN' })]
				},
				{ guard: 'currentStartup', target: '.openFailed' }
			],
			SESSION_OBSERVATION_CLEANUP_FAILED: {
				guard: 'currentReadinessScope',
				actions: [assign({ cleanupFailed: true }), raise({ type: 'SHUTDOWN' })]
			},
			SHUTDOWN: '.closing'
		},
		states: {
			opening: { meta: { status: 'starting' } },
			openFailed: {
				meta: { status: 'unavailable' },
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
					onDone: '#application-readiness.closing'
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
						actions: [
							assign({ observationFailed: true }),
							raise({ type: 'OBSERVED', observation: { status: 'error' } })
						]
					}
				},
				states: {
					draining: {
						meta: { status: 'closing' },
						entry: sendTo('readiness', { type: 'SHUTDOWN' }),
						on: { OBSERVED: {}, SHUTDOWN: {}, SESSION_STATUS: {}, SESSION_OBSERVATION_FAILED: {} }
					},
					route: {
						entry: assign({ write: undefined }),
						always: [
							{ guard: ({ context }) => context.observation.status === 'ready', target: 'library' },
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
						meta: { status: 'signedOut' },
						on: {
							OBSERVED: { target: 'route', actions: 'rememberObservation' },
							CREATE: { target: 'creating', actions: assign({ feedback: 'none' }) },
							RESTORE: {
								target: 'restoring',
								actions: assign(({ context, event }) => ({
									phrase: event.phrase,
									attempt: context.attempt + 1,
									feedback: 'none'
								}))
							}
						}
					},
					waiting: { on: { OBSERVED: { target: 'route', actions: 'rememberObservation' } } },
					unavailable: {
						meta: { status: 'unavailable' },
						on: {
							RETRY: [
								{ guard: ({ context }) => context.observationFailed, target: 'reobserving' },
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
							assign(({ context }) => ({
								observationAttempt: context.observationAttempt + 1,
								observationFailed: false
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
						initial: 'active',
						states: { active: {}, stopping: { meta: { status: 'closing' } } },
						on: { SHUTDOWN: '.stopping' },
						invoke: {
							src: 'create',
							input: ({ context }) => required(context.host),
							onDone: [
								{ guard: 'stoppingCreate', target: '#application-readiness.running.draining' },
								{ target: 'route', actions: 'refresh' }
							],
							onError: [
								{ guard: 'stoppingCreate', target: '#application-readiness.running.draining' },
								{ target: 'route', actions: ['failedIdentity', 'refresh'] }
							]
						}
					},
					restoring: {
						initial: 'active',
						states: { active: {}, stopping: { meta: { status: 'closing' } } },
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
									target: '#application-readiness.running.draining',
									actions: 'clearPhrase'
								},
								{
									target: 'route',
									actions: [
										assign({
											feedback: ({ event }) =>
												event.output.outcome === 'restored'
													? 'none'
													: event.output.outcome === 'invalid'
														? 'restoreInvalid'
														: 'restoreFailed'
										}),
										'clearPhrase',
										'refresh'
									]
								}
							],
							onError: [
								{
									guard: 'stoppingRestore',
									target: '#application-readiness.running.draining',
									actions: 'clearPhrase'
								},
								{
									target: 'route',
									actions: [assign({ feedback: 'restoreFailed' }), 'clearPhrase', 'refresh']
								}
							]
						}
					},
					loggingOut: {
						initial: 'active',
						states: { active: {}, stopping: { meta: { status: 'closing' } } },
						on: { SHUTDOWN: '.stopping' },
						invoke: {
							src: 'logout',
							input: ({ context }) => required(context.host),
							onDone: [
								{ guard: 'stoppingLogout', target: '#application-readiness.running.draining' },
								{ target: 'route', actions: 'refresh' }
							],
							onError: [
								{ guard: 'stoppingLogout', target: '#application-readiness.running.draining' },
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
								{ guard: 'stoppingBootstrap', target: '#application-readiness.running.draining' },
								{ guard: 'replacingBootstrap', target: '#application-readiness.running.route' },
								{
									guard: ({ event }) => event.output.outcome === 'ready',
									target: '.ready',
									actions: assign({
										write: ({ event }) =>
											event.output.outcome === 'ready' ? event.output.write : undefined
									})
								},
								{ guard: ({ event }) => event.output.outcome === 'conflict', target: '.conflict' },
								{ target: '.failed' }
							]
						},
						on: {
							OBSERVED: [
								{ guard: 'sameBinding' },
								{ target: '#application-readiness.running.route', actions: 'rememberObservation' }
							]
						},
						states: {
							bootstrapping: {
								meta: { status: 'openingLibrary' },
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
								meta: { status: 'closing' },
								on: { SHUTDOWN: {}, OBSERVED: { actions: 'rememberObservation' } }
							},
							replacing: {
								meta: { status: 'openingLibrary' },
								on: { OBSERVED: { actions: 'rememberObservation' }, SHUTDOWN: 'stopping' }
							},
							conflict: {
								meta: { status: 'conflict' },
								on: { LOGOUT: '#application-readiness.running.loggingOut' }
							},
							failed: {
								meta: { status: 'rootFailed' },
								on: {
									RETRY: { target: '#application-readiness.running.library', reenter: true },
									LOGOUT: '#application-readiness.running.loggingOut'
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
											guard: ({ context }) => context.productExit === 'restore',
											target: '#application-readiness.running.restoring'
										},
										{
											guard: ({ context }) => context.productExit === 'logout',
											target: '#application-readiness.running.loggingOut'
										},
										{
											guard: ({ context }) => context.productExit === 'replace',
											target: '#application-readiness.running.route'
										},
										{ target: '#application-readiness.running.draining' }
									]
								},
								on: {
									RESTORE: {
										target: '.stopping',
										actions: [
											assign(({ context, event }) => ({
												productExit: 'restore' as const,
												phrase: event.phrase,
												attempt: context.attempt + 1,
												feedback: 'none' as const
											})),
											sendTo('library', { type: 'SHUTDOWN' })
										]
									},
									LOGOUT: {
										target: '.stopping',
										actions: [
											assign({ productExit: 'logout' }),
											sendTo('library', { type: 'SHUTDOWN' })
										]
									},
									SHUTDOWN: {
										target: '.stopping',
										actions: [
											assign({ productExit: 'shutdown' }),
											sendTo('library', { type: 'SHUTDOWN' })
										]
									},
									OBSERVED: [
										{ guard: 'sameBinding' },
										{
											target: '.stopping',
											actions: [
												'rememberObservation',
												assign({ productExit: 'replace' }),
												sendTo('library', { type: 'SHUTDOWN' })
											]
										}
									]
								},
								states: {
									stopping: {
										meta: { status: 'closing' },
										on: {
											LOGOUT: {},
											RESTORE: {},
											SHUTDOWN: { actions: assign({ productExit: 'shutdown' }) },
											OBSERVED: { actions: 'rememberObservation' }
										}
									},
									syncPending: {
										meta: { status: 'localSaved' },
										invoke: {
											src: 'global',
											input: ({ context }) => required(context.write),
											onDone: 'synced',
											onError: 'syncFailed'
										}
									},
									synced: { meta: { status: 'synced' } },
									syncFailed: {
										meta: { status: 'syncFailed' },
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
				meta: { status: 'closing' },
				entry: [
					'clearPhrase',
					({ context }) => context.host?.release(),
					sendTo('startup', { type: 'SHUTDOWN' })
				],
				on: { SESSION_ACQUIRED: {}, SESSION_STARTUP_FAILED: {}, SESSION_STARTING: {}, SHUTDOWN: {} }
			},
			finished: {
				always: [
					{ guard: ({ context }) => context.cleanupFailed, target: 'cleanupFailed' },
					{ guard: ({ context }) => context.ownerFailed, target: 'ownerFailed' },
					{ target: 'closed' }
				]
			},
			cleanupFailed: { meta: { status: 'cleanupFailed' }, type: 'final', entry: 'clearResources' },
			ownerFailed: { meta: { status: 'ownerFailed' }, type: 'final', entry: 'clearResources' },
			closed: {
				meta: { status: 'closed' },
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
type ApplicationSnapshot<Session extends object> = SnapshotFrom<
	ReturnType<typeof createApplicationReadinessMachine<Session>>
>
type MachineStatus = Exclude<ApplicationStatus, 'configuration'>
export function selectApplicationView<Session extends object>(
	snapshot: ApplicationSnapshot<Session> | undefined,
	configured: boolean
) {
	const status: ApplicationStatus = !configured
		? 'configuration'
		: snapshot
			? (Object.values(snapshot.getMeta()).find((meta) => meta !== undefined)?.status ?? 'working')
			: 'starting'
	return {
		status,
		feedback: snapshot?.context.feedback === 'none' ? undefined : snapshot?.context.feedback,
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
	return snapshot?.matches({ running: 'library' }) &&
		!snapshot.context.ownerFailed &&
		!snapshot.context.cleanupFailed &&
		snapshot.context.observation.status === 'ready'
		? snapshot.context.observation.recovery
		: undefined
}

/** The invocation ID is owned by ready; never expose actors from a draining binding. */
export function selectLibraryActor<Session extends object>(
	snapshot: ApplicationSnapshot<Session> | undefined
) {
	return snapshot?.matches({ running: { library: 'ready' } }) &&
		!snapshot.matches({ running: { library: { ready: 'stopping' } } })
		? snapshot.children.library
		: undefined
}
