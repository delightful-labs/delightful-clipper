import { types, type SnapshotFrom, createCallbackLogic, setup, createAsyncLogic } from 'xstate'
import { t } from '../../localization/index.js'
import { stateFeedback } from '../../contracts/feedback.js'

import type { NamedState } from '../../contracts/feedback.js'

export type ShellStatus = 'preparing' | 'ready' | 'waiting' | 'failed' | 'unsupported'
export type ShellWorker = EventTarget & { state: string }
export type ShellRegistration = EventTarget & {
	active: ShellWorker | null
	waiting: ShellWorker | null
	installing: ShellWorker | null
}
export type ShellEvent = { type: 'STATUS'; status: ShellStatus } | { type: 'RETRY' | 'SHUTDOWN' }
export type ShellPlatform = {
	register: () => Promise<ShellRegistration | undefined>
	observe: (registration: ShellRegistration, report: (event: ShellEvent) => void) => () => void
}
type Context = {
	registration: ShellRegistration | undefined
}
const preparing: NamedState & { status: ShellStatus } = {
	name: t('offline.preparing'),
	variant: 'info',
	status: 'preparing'
}
export function createShellRegistrationMachine(platform: ShellPlatform) {
	const actors = {
		register: createAsyncLogic({ run: () => platform.register() }),
		observe: createCallbackLogic<ShellEvent, ShellRegistration>(({ input, sendBack }) =>
			platform.observe(input, sendBack)
		)
	}
	return setup({
		schemas: {
			context: types<Context>(),
			events: {
				STATUS: types<{ status: ShellStatus }>(),
				RETRY: types(),
				SHUTDOWN: types()
			},
			internalEvents: { ATTEMPT_SETTLED: types(), TIMED_OUT: types() },
			meta: types<NamedState & { status: ShellStatus }>(),
			tags: types<string>(),
			children: {
				register: types<import('xstate').ActorRefFrom<typeof actors.register>>(),
				observe: types<import('xstate').ActorRefFrom<typeof actors.observe>>()
			}
		},
		actors
	}).createMachine({
		id: 'offline-shell',
		initial: 'running',
		context: { registration: undefined },
		on: { SHUTDOWN: { target: '.closed' } },
		states: {
			running: {
				type: 'parallel',
				states: {
					admission: {
						initial: 'blocked',
						states: {
							blocked: {
								on: {
									STATUS: ({ event }) => {
										if (event.status !== 'preparing') return { target: 'open' }
									},
									ATTEMPT_SETTLED: { target: 'open' },
									TIMED_OUT: { target: 'open' }
								}
							},
							open: {}
						}
					},
					attempt: {
						initial: 'active',
						on: { RETRY: { target: '.active', reenter: true } },
						states: {
							active: {
								type: 'parallel',
								states: {
									deadline: {
										initial: 'pending',
										states: {
											pending: {
												after: {
													45000: (_, enq) => {
														enq.raise({ type: 'TIMED_OUT' })
														return { target: 'settled' }
													}
												},
												on: {
													STATUS: ({ event }) => {
														if (event.status !== 'preparing') return { target: 'settled' }
													},
													ATTEMPT_SETTLED: { target: 'settled' }
												}
											},
											settled: {}
										}
									},
									workflow: {
										id: 'shell-registration-attempt',
										initial: 'registering',
										on: { TIMED_OUT: { target: '.failed' } },
										states: {
											registering: {
												meta: {
													status: 'preparing',
													name: t('offline.preparing'),
													variant: 'info'
												},
												invoke: {
													id: 'register',
													src: 'register',
													onDone: ({ event }, enq) => {
														if (event.output)
															return { target: 'watching', context: { registration: event.output } }
														enq.raise({ type: 'ATTEMPT_SETTLED' })
														return { target: 'unsupported' }
													},
													onError: (_, enq) => {
														enq.raise({ type: 'ATTEMPT_SETTLED' })
														return { target: 'failed' }
													}
												}
											},
											watching: {
												initial: 'preparing',
												invoke: {
													id: 'observe',
													src: 'observe',
													input: ({ context }) => {
														if (!context.registration) throw new Error('Missing shell registration')
														return context.registration
													},
													onError: (_, enq) => {
														enq.raise({ type: 'ATTEMPT_SETTLED' })
														return { target: 'failed' }
													}
												},
												on: {
													STATUS: ({ event }) => {
														if (event.status === 'ready') return { target: '.ready' }
														if (event.status === 'waiting') return { target: '.waiting' }
														if (event.status === 'failed') return { target: '.failed' }
														if (event.status === 'unsupported') return { target: '.unsupported' }
														return { target: '.preparing' }
													}
												},
												states: {
													preparing: {
														meta: {
															status: 'preparing',
															name: t('offline.preparing'),
															variant: 'info'
														}
													},
													ready: { meta: { status: 'ready' } },
													waiting: {
														meta: { status: 'waiting', name: t('offline.update'), variant: 'info' }
													},
													failed: {
														meta: { status: 'failed', name: t('offline.failed'), variant: 'error' },
														tags: ['retryable']
													},
													unsupported: {
														meta: {
															status: 'unsupported',
															name: t('offline.unsupported'),
															variant: 'info'
														}
													}
												}
											},
											failed: {
												meta: { status: 'failed', name: t('offline.failed'), variant: 'error' },
												tags: ['retryable'],
												entry: () => ({ context: { registration: undefined } })
											},
											unsupported: {
												meta: {
													status: 'unsupported',
													name: t('offline.unsupported'),
													variant: 'info'
												},
												entry: () => ({ context: { registration: undefined } })
											}
										}
									}
								}
							}
						}
					}
				}
			},
			closed: { type: 'final', entry: () => ({ context: { registration: undefined } }) }
		}
	})
}

export function selectShellView(
	snapshot: SnapshotFrom<ReturnType<typeof createShellRegistrationMachine>> | undefined
) {
	const meta = snapshot ? Object.values(snapshot.getMeta()) : [preparing]
	return {
		status: meta.find((state) => state !== undefined)?.status,
		message: stateFeedback(meta),
		admitted: snapshot?.matches({ running: { admission: 'open' } }) ?? false,
		canRetry: snapshot ? snapshot.hasTag('retryable') && snapshot.can({ type: 'RETRY' }) : false
	}
}
