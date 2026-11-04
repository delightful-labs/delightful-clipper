import { t } from '../../localization/index.js'
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
	status: ShellStatus
	message: WorkflowMessage | undefined
}
function shellMessage(status: ShellStatus): WorkflowMessage {
	return {
		text: t(
			status === 'ready'
				? 'offline.ready'
				: status === 'waiting'
					? 'offline.update'
					: status === 'failed'
						? 'offline.failed'
						: status === 'unsupported'
							? 'offline.unsupported'
							: 'offline.preparing'
		),
		variant: status === 'failed' ? 'error' : 'info'
	}
}
export function createShellRegistrationMachine(platform: ShellPlatform) {
	const actors = {
		register: fromPromise(() => platform.register()),
		observe: fromCallback<ShellEvent, ShellRegistration>(({ input, sendBack }) =>
			platform.observe(input, sendBack)
		)
	}
	const model = setup<Context, ShellEvent, typeof actors, {}, {}, {}, never, string>({ actors })
	const show = (value: ShellStatus) =>
		model.assign({ status: value, message: () => shellMessage(value) })
	const status = (value: ShellStatus) => model.createStateConfig({ entry: show(value) })
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
				...status('preparing'),
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
					preparing: status('preparing'),
					ready: status('ready'),
					waiting: status('waiting'),
					failed: status('failed'),
					unsupported: status('unsupported')
				}
			},
			failed: {
				entry: [show('failed'), assign({ registration: undefined })]
			},
			unsupported: {
				entry: [show('unsupported'), assign({ registration: undefined })]
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
			registration: undefined,
			status: 'preparing',
			message: shellMessage('preparing')
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
			closed: { type: 'final', entry: assign({ registration: undefined, message: undefined }) }
		}
	})
}

export function selectShellView(
	snapshot: SnapshotFrom<ReturnType<typeof createShellRegistrationMachine>> | undefined
) {
	return {
		message: snapshot ? snapshot.context.message : shellMessage('preparing'),
		admitted: snapshot?.matches({ running: { admission: 'open' } }) ?? false,
		canRetry: snapshot?.context.status === 'failed' && snapshot.can({ type: 'RETRY' })
	}
}
