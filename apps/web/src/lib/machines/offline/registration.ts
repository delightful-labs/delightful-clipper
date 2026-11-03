import { t } from '../../localization/index.js'
import type { WorkflowMessage } from '../../contracts/feedback.js'
import type { SnapshotFrom } from 'xstate'
import { assign, fromCallback, fromPromise, setup } from 'xstate'
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
	admitted: boolean
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
	return setup<Context, ShellEvent, typeof actors, {}, {}, {}, never, string>({
		actors
	}).createMachine({
		id: 'offline-shell',
		initial: 'registering',
		context: () => ({
			registration: undefined,
			admitted: false,
			status: 'preparing',
			message: shellMessage('preparing')
		}),
		on: { SHUTDOWN: '.closed' },
		after: { 45000: { guard: ({ context }) => !context.admitted, target: '.failed' } },
		states: {
			registering: {
				entry: assign({ status: 'preparing', message: () => shellMessage('preparing') }),
				invoke: {
					src: 'register',
					onDone: [
						{
							guard: ({ event }) => !!event.output,
							target: 'watching',
							actions: assign({ registration: ({ event }) => event.output })
						},
						{ target: 'unsupported' }
					],
					onError: 'failed'
				}
			},
			watching: {
				invoke: {
					src: 'observe',
					input: ({ context }) => {
						if (!context.registration) throw new Error('Missing shell registration')
						return context.registration
					},
					onError: 'failed'
				},
				on: {
					STATUS: {
						actions: assign({
							status: ({ event }) => event.status,
							message: ({ event }) => shellMessage(event.status),
							admitted: ({ context, event }) => context.admitted || event.status !== 'preparing'
						})
					},
					RETRY: 'registering'
				}
			},
			failed: {
				entry: assign({
					status: 'failed',
					admitted: true,
					registration: undefined,
					message: () => shellMessage('failed')
				}),
				on: { RETRY: 'registering' }
			},
			unsupported: {
				type: 'final',
				entry: assign({
					status: 'unsupported',
					admitted: true,
					registration: undefined,
					message: () => shellMessage('unsupported')
				})
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
		canRetry: snapshot?.context.status === 'failed' && snapshot.can({ type: 'RETRY' })
	}
}
