import { assign, fromCallback, fromPromise, sendTo, setup, stateIn } from 'xstate'
import { restorationMachine } from 'delightful-local-first/restoration/workflow'
import type { RestorationReport } from 'delightful-local-first/restoration/contracts'
import type {
	AccountHost,
	AccountInput,
	AccountObservation,
	RootAccess,
	RootWrite
} from '../contracts/account.js'

type Event =
	| { type: 'OBSERVED'; observation: AccountObservation }
	| { type: 'CREATE' | 'LOGOUT' | 'RETRY' | 'SHUTDOWN' }
	| { type: 'RESTORE'; phrase: string }
	| RestorationReport

type Context = {
	host: AccountHost | undefined
	open: AccountInput['open']
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
function root(context: Context): RootAccess {
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

const accountActors = {
	open: fromPromise(({ input }: { input: AccountInput['open'] }) => input()),
	close: fromPromise(({ input }: { input: AccountHost }) => input.close()),
	create: fromPromise(({ input }: { input: AccountHost }) => input.create()),
	logout: fromPromise(({ input }: { input: AccountHost }) => input.logout()),
	retry: fromPromise(({ input }: { input: AccountHost }) => input.retry()),
	readRoot: fromPromise(({ input }: { input: RootAccess }) => input.read()),
	ensureRoot: fromPromise(async ({ input }: { input: RootAccess }) => input.ensure()),
	local: fromPromise(({ input }: { input: RootWrite }) => input.local()),
	global: fromPromise(({ input }: { input: RootWrite }) => input.global()),
	restore: restorationMachine,
	observe: fromCallback<Event, AccountHost>(({ input, sendBack }) => {
		try {
			return input.subscribe((observation) => sendBack({ type: 'OBSERVED', observation }))
		} catch {
			sendBack({ type: 'OBSERVED', observation: { status: 'error' } })
			return undefined
		}
	})
}

export const accountMachine = setup<
	Context,
	Event,
	typeof accountActors,
	{},
	{
		refresh: undefined
		clearPhrase: undefined
		rememberObservation: undefined
		failedIdentity: undefined
	},
	{
		stoppingOpen: undefined
		stoppingCreate: undefined
		stoppingRestore: undefined
		stoppingLogout: undefined
		stoppingLocal: undefined
		sameBinding: undefined
	},
	never,
	string,
	AccountInput
>({
	actors: accountActors,
	guards: {
		stoppingOpen: stateIn({ opening: 'stopping' }),
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
		refresh: assign(({ context }) => ({ observation: observe(required(context.host)) })),
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
		open: input.open,
		host: undefined,
		observation: { status: 'signed-out' },
		write: undefined,
		phrase: '',
		attempt: 0,
		feedback: 'none'
	}),
	states: {
		opening: {
			initial: 'active',
			states: { active: {}, stopping: {} },
			on: { SHUTDOWN: '.stopping' },
			invoke: {
				src: 'open',
				input: ({ context }) => context.open,
				onDone: [
					{
						guard: 'stoppingOpen',
						target: 'closing',
						actions: assign({ host: ({ event }) => event.output })
					},
					{ target: 'running', actions: assign({ host: ({ event }) => event.output }) }
				],
				onError: [{ guard: 'stoppingOpen', target: 'closed' }, { target: 'openFailed' }]
			}
		},
		openFailed: { on: { RETRY: 'opening', SHUTDOWN: 'closed' } },
		running: {
			initial: 'route',
			invoke: {
				src: 'observe',
				input: ({ context }) => required(context.host),
				onError: '.unavailable'
			},
			on: { SHUTDOWN: '#account.closing', OBSERVED: { actions: 'rememberObservation' } },
			states: {
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
					on: { RETRY: 'retrying', OBSERVED: { target: 'route', actions: 'rememberObservation' } }
				},
				retrying: {
					invoke: {
						src: 'retry',
						input: ({ context }) => required(context.host),
						onDone: { target: 'route', actions: 'refresh' },
						onError: { target: 'unavailable', actions: 'refresh' }
					}
				},
				creating: {
					initial: 'active',
					states: { active: {}, stopping: {} },
					on: { SHUTDOWN: '.stopping' },
					invoke: {
						src: 'create',
						input: ({ context }) => required(context.host),
						onDone: [
							{ guard: 'stoppingCreate', target: '#account.closing' },
							{ target: 'route', actions: 'refresh' }
						],
						onError: [
							{ guard: 'stoppingCreate', target: '#account.closing' },
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
							{ guard: 'stoppingRestore', target: '#account.closing', actions: 'clearPhrase' },
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
							{ guard: 'stoppingRestore', target: '#account.closing', actions: 'clearPhrase' },
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
							{ guard: 'stoppingLogout', target: '#account.closing' },
							{ target: 'route', actions: 'refresh' }
						],
						onError: [
							{ guard: 'stoppingLogout', target: '#account.closing' },
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
									{ guard: 'stoppingLocal', target: '#account.closing' },
									{ target: 'ready' }
								],
								onError: [
									{ guard: 'stoppingLocal', target: '#account.closing' },
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
			entry: 'clearPhrase',
			invoke: {
				src: 'close',
				input: ({ context }) => required(context.host),
				onDone: 'closed',
				onError: 'closeFailed'
			}
		},
		closeFailed: { on: { RETRY: 'closing' } },
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
