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
		context: { registration: undefined, admitted: false, status: 'preparing' },
		on: { SHUTDOWN: '.closed' },
		after: { 45000: { guard: ({ context }) => !context.admitted, target: '.failed' } },
		states: {
			registering: {
				entry: assign({ status: 'preparing' }),
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
							admitted: ({ context, event }) => context.admitted || event.status !== 'preparing'
						})
					},
					RETRY: 'registering'
				}
			},
			failed: {
				entry: assign({ status: 'failed', admitted: true, registration: undefined }),
				on: { RETRY: 'registering' }
			},
			unsupported: {
				type: 'final',
				entry: assign({ status: 'unsupported', admitted: true, registration: undefined })
			},
			closed: { type: 'final', entry: assign({ registration: undefined }) }
		}
	})
}
