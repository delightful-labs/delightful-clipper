import { t } from '../../localization/index.js'
import { stateFeedback } from '../../contracts/feedback.js'
import type { NamedState } from '../../contracts/feedback.js'
import type { WorkflowMessage } from '../../contracts/feedback.js'
import type { SnapshotFrom } from 'xstate'
import { assign, fromCallback, fromPromise, setup, raise } from 'xstate'
export type ShellStatus = 'preparing' | 'ready' | 'waiting' | 'failed' | 'unsupported'
export type ShellWorker = EventTarget & { state: string }
export type ShellRegistration = EventTarget & {
	active: ShellWorker | null
	waiting: ShellWorker | null
	installing: ShellWorker | null
}
export type ShellEvent =
	| { type: 'STATUS'; status: ShellStatus }
	| { type: 'RETRY' | 'SHUTDOWN' | 'ATTEMPT_SETTLED' | 'TIMED_OUT' }
export type ShellPlatform = {
	register: () => Promise<ShellRegistration | undefined>
	observe: (registration: ShellRegistration, report: (event: ShellEvent) => void) => () => void
}
type Context = {
	registration: ShellRegistration | undefined
}
const preparing = {
	name: t('offline.preparing'),
	variant: 'info' as const,
	status: 'preparing' as const
}
export function createShellRegistrationMachine(platform: ShellPlatform) {
	const actors = {
		register: fromPromise(() => platform.register()),
		observe: fromCallback<ShellEvent, ShellRegistration>(({ input, sendBack }) =>
			platform.observe(input, sendBack)
		)
	}
	const model = setup<
		Context,
		ShellEvent,
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		undefined,
		undefined,
		{ type: string },
		NamedState & { status: ShellStatus }
	>({ actors })
	const status = (value: ShellStatus, name: string, variant: WorkflowMessage['variant'] = 'info') =>
		model.createStateConfig({ meta: { status: value, name, variant } })
	const settled = {
		guard: ({ event }: { event: ShellEvent }) =>
			event.type === 'STATUS' && event.status !== 'preparing',
		target: 'open'
	}
	const workflow = model.createStateConfig({
		id: 'shell-registration-attempt',
		initial: 'registering',
		on: { TIMED_OUT: '.failed' },
		states: {
			registering: {
				...status('preparing', t('offline.preparing')),
				invoke: {
					src: 'register',
					onDone: [
						{
							guard: ({ event }) => !!event.output,
							target: 'watching',
							actions: assign({ registration: ({ event }) => event.output })
						},
						{ target: 'unsupported', actions: raise({ type: 'ATTEMPT_SETTLED' }) }
					],
					onError: { target: 'failed', actions: raise({ type: 'ATTEMPT_SETTLED' }) }
				}
			},
			watching: {
				initial: 'preparing',
				invoke: {
					src: 'observe',
					input: ({ context }) => {
						if (!context.registration) throw new Error('Missing shell registration')
						return context.registration
					},
					onError: { target: 'failed', actions: raise({ type: 'ATTEMPT_SETTLED' }) }
				},
				on: {
					STATUS: [
						{ guard: ({ event }) => event.status === 'ready', target: '.ready' },
						{
							guard: ({ event }) => event.status === 'waiting',
							target: '.waiting'
						},
						{ guard: ({ event }) => event.status === 'failed', target: '.failed' },
						{
							guard: ({ event }) => event.status === 'unsupported',
							target: '.unsupported'
						},
						{ target: '.preparing' }
					]
				},
				states: {
					preparing: status('preparing', t('offline.preparing')),
					ready: { meta: { status: 'ready' } },
					waiting: status('waiting', t('offline.update')),
					failed: { ...status('failed', t('offline.failed'), 'error'), tags: 'retryable' },
					unsupported: status('unsupported', t('offline.unsupported'))
				}
			},
			failed: {
				...status('failed', t('offline.failed'), 'error'),
				tags: 'retryable',
				entry: assign({ registration: undefined })
			},
			unsupported: {
				...status('unsupported', t('offline.unsupported')),
				entry: assign({ registration: undefined })
			}
		}
	})
	const attempt = model.createStateConfig({
		type: 'parallel',
		states: {
			deadline: {
				initial: 'pending',
				states: {
					pending: {
						after: {
							45000: { target: 'settled', actions: raise({ type: 'TIMED_OUT' }) }
						},
						on: {
							STATUS: { ...settled, target: 'settled' },
							ATTEMPT_SETTLED: 'settled'
						}
					},
					settled: {}
				}
			},
			workflow
		}
	})
	return model.createMachine({
		id: 'offline-shell',
		initial: 'running',
		context: () => ({
			registration: undefined
		}),
		on: { SHUTDOWN: '.closed' },
		states: {
			running: {
				type: 'parallel',
				states: {
					admission: {
						initial: 'blocked',
						states: {
							blocked: { on: { STATUS: settled, ATTEMPT_SETTLED: 'open', TIMED_OUT: 'open' } },
							open: {}
						}
					},
					attempt: {
						initial: 'active',
						on: { RETRY: '.active' },
						states: {
							active: attempt
						}
					}
				}
			},
			closed: { type: 'final', entry: assign({ registration: undefined }) }
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
