import {
	createSessionStartupMachine,
	createSessionReadinessMachine
} from 'delightful-local-first/session/workflow'
import type {
	SessionStartupReport,
	SessionReadinessReport,
	SessionReadinessScope
} from 'delightful-local-first/session/contracts'
import { assign, fromPromise, raise, sendTo, setup, stateIn } from 'xstate'
import { restorationMachine } from 'delightful-local-first/restoration/workflow'
import type { RestorationReport } from 'delightful-local-first/restoration/contracts'
import type {
	AccountHost,
	AccountInput,
	AccountObservation,
	RootAccess,
	RootWrite
} from '../contracts/account.js'

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
	observation: AccountObservation
	write: RootWrite | undefined
	phrase: string
	attempt: number
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

export function createAccountMachine<Session extends object>() {
	const accountActors = {
		startup: createSessionStartupMachine<Session>(),
		readiness: createSessionReadinessMachine(),
		create: fromPromise(({ input }: { input: AccountHost }) => input.create()),
		logout: fromPromise(({ input }: { input: AccountHost }) => input.logout()),
		readRoot: fromPromise(({ input }: { input: RootAccess }) => input.read()),
		ensureRoot: fromPromise(async ({ input }: { input: RootAccess }) => input.ensure()),
		local: fromPromise(({ input }: { input: RootWrite }) => input.local()),
		global: fromPromise(({ input }: { input: RootWrite }) => input.global()),
		restore: restorationMachine
	}

	return setup<
		Context<Session>,
		Event<Session>,
		typeof accountActors,
		{},
		{
			refresh: undefined
			clearPhrase: undefined
			rememberObservation: undefined
			failedIdentity: undefined
		},
		{
			stoppingCreate: undefined
			stoppingRestore: undefined
			stoppingLogout: undefined
			stoppingLocal: undefined
			sameBinding: undefined
			currentStartup: undefined
			currentReadiness: undefined
		},
		never,
		string,
		AccountInput<Session>
	>({
		actors: accountActors,
		guards: {
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
			stoppingLocal: stateIn({ running: { library: { local: 'stopping' } } }),
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
			rememberObservation: assign(({ event }) =>
				event.type === 'OBSERVED' ? { observation: event.observation } : {}
			),
			failedIdentity: assign({ feedback: 'identityFailed' })
		}
	}).createMachine({
		id: 'account',
		initial: 'opening',
		context: ({ input }) => ({
			input,
			scope: input.startup.scope,
			readinessScope: undefined,
			retryAttempt: 0,
			observationAttempt: 0,
			observationFailed: false,
			host: undefined,
			observation: { status: 'signed-out' },
			write: undefined,
			phrase: '',
			attempt: 0,
			feedback: 'none'
		}),

		entry: sendTo('startup', ({ context }) => ({ type: 'START', ...context.input.startup })),
		invoke: {
			id: 'startup',
			src: 'startup',
			input: ({ self }) => ({ reportTo: self }),
			onDone: '#account.closed'
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
			SESSION_STARTUP_FAILED: { guard: 'currentStartup', target: '.openFailed' },
			SHUTDOWN: '.closing'
		},
		states: {
			opening: {},
			openFailed: {
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
					onDone: '#account.closing'
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
					},
					SESSION_OBSERVATION_CLEANUP_FAILED: {
						guard: 'currentReadiness',
						actions: assign({ observationFailed: true })
					}
				},
				states: {
					draining: {
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
						states: { active: {}, stopping: {} },
						on: { SHUTDOWN: '.stopping' },
						invoke: {
							src: 'create',
							input: ({ context }) => required(context.host),
							onDone: [
								{ guard: 'stoppingCreate', target: '#account.running.draining' },
								{ target: 'route', actions: 'refresh' }
							],
							onError: [
								{ guard: 'stoppingCreate', target: '#account.running.draining' },
								{ target: 'route', actions: ['failedIdentity', 'refresh'] }
							]
						}
					},
					restoring: {
						initial: 'active',
						states: { active: {}, stopping: {} },
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
									target: '#account.running.draining',
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
									target: '#account.running.draining',
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
						states: { active: {}, stopping: {} },
						on: { SHUTDOWN: '.stopping' },
						invoke: {
							src: 'logout',
							input: ({ context }) => required(context.host),
							onDone: [
								{ guard: 'stoppingLogout', target: '#account.running.draining' },
								{ target: 'route', actions: 'refresh' }
							],
							onError: [
								{ guard: 'stoppingLogout', target: '#account.running.draining' },
								{ target: 'route', actions: ['failedIdentity', 'refresh'] }
							]
						}
					},
					library: {
						initial: 'reading',
						on: {
							OBSERVED: [
								{ guard: 'sameBinding' },
								{ target: '#account.running.route', actions: 'rememberObservation' }
							]
						},
						states: {
							reading: {
								invoke: {
									src: 'readRoot',
									input: ({ context }) => root(context),
									onDone: [
										{ guard: ({ event }) => event.output === 'incompatible', target: 'conflict' },
										{ target: 'ensuring' }
									],
									onError: 'failed'
								}
							},
							conflict: { on: { LOGOUT: '#account.running.loggingOut' } },
							ensuring: {
								invoke: {
									src: 'ensureRoot',
									input: ({ context }) => root(context),
									onDone: {
										target: 'local',
										actions: assign({ write: ({ event }) => event.output })
									},
									onError: 'failed'
								}
							},
							local: {
								initial: 'active',
								states: { active: {}, stopping: {} },
								on: { SHUTDOWN: '.stopping' },
								invoke: {
									src: 'local',
									input: ({ context }) => required(context.write),
									onDone: [
										{ guard: 'stoppingLocal', target: '#account.running.draining' },
										{ target: 'ready' }
									],
									onError: [
										{ guard: 'stoppingLocal', target: '#account.running.draining' },
										{ target: 'failed' }
									]
								}
							},
							failed: { on: { RETRY: 'reading', LOGOUT: '#account.running.loggingOut' } },
							ready: {
								initial: 'syncPending',
								on: { LOGOUT: '#account.running.loggingOut' },
								states: {
									syncPending: {
										invoke: {
											src: 'global',
											input: ({ context }) => required(context.write),
											onDone: 'synced',
											onError: 'syncFailed'
										}
									},
									synced: {},
									syncFailed: { on: { RETRY: '#account.running.library.reading' } }
								}
							}
						}
					}
				}
			},
			closing: {
				entry: [
					'clearPhrase',
					({ context }) => context.host?.release(),
					sendTo('startup', { type: 'SHUTDOWN' })
				],
				on: { SESSION_ACQUIRED: {}, SESSION_STARTUP_FAILED: {}, SESSION_STARTING: {}, SHUTDOWN: {} }
			},
			closed: {
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
