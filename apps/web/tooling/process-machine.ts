import { assign, fromCallback, sendTo, setup } from 'xstate'
export type ProcessInput = { command: string; env: NodeJS.ProcessEnv }
export type ProcessEvent =
	| { type: 'CLOSE'; code: number | null; httpStatus?: string }
	| { type: 'ERROR' | 'OPEN_FAILED' | 'CANCEL' }
export type ProcessResult = {
	outcome: 'succeeded' | 'failed' | 'cancelled'
	code: number | null
	startFailed: boolean
	httpStatus: string | undefined
}
export type ProcessPort = { signal: (signal: 'SIGTERM' | 'SIGKILL') => void; release: () => void }
export type ProcessOpen = (
	input: ProcessInput,
	report: (event: ProcessEvent) => void
) => ProcessPort
/** Own one process through close; cancellation cannot release its parent before exit. */
export function createProcessMachine(open: ProcessOpen) {
	type Context = {
		input: ProcessInput | undefined
		cancelled: boolean
		failed: boolean
		result: ProcessResult | undefined
	}
	const processActor = fromCallback<{ type: 'SIGTERM' | 'SIGKILL' }, ProcessInput>(
		({ input, sendBack, receive }) => {
			let port: ProcessPort | undefined
			try {
				port = open(input, sendBack)
			} catch {
				sendBack({ type: 'OPEN_FAILED' })
			}
			receive((event) => {
				try {
					port?.signal(event.type)
				} catch {
					sendBack({ type: 'ERROR' })
				}
			})
			return () => port?.release()
		}
	)
	return setup<
		Context,
		ProcessEvent,
		{ process: typeof processActor },
		{},
		{ cancel: undefined },
		{},
		never,
		string,
		ProcessInput,
		ProcessResult
	>({
		actors: { process: processActor },
		actions: { cancel: assign({ cancelled: true }) }
	}).createMachine({
		id: 'preview-process',
		initial: 'owning',
		context: ({ input }) => ({ input, cancelled: false, failed: false, result: undefined }),
		output: ({ context }) => {
			if (!context.result) throw new Error('Missing process result')
			return context.result
		},
		states: {
			owning: {
				initial: 'running',
				invoke: {
					id: 'process',
					src: 'process',
					input: ({ context }) => {
						if (!context.input) throw new Error('Missing process input')
						return context.input
					}
				},
				on: {
					CLOSE: {
						target: 'closed',
						actions: assign({
							result: ({ context, event }) => ({
								outcome: context.cancelled
									? 'cancelled'
									: event.code === 0 && !context.failed
										? 'succeeded'
										: 'failed',
								code: event.code,
								startFailed: context.failed,
								httpStatus: event.httpStatus
							})
						})
					},
					OPEN_FAILED: {
						target: 'closed',
						actions: assign({
							result: ({ context }) => ({
								outcome: context.cancelled ? 'cancelled' : 'failed',
								code: null,
								startFailed: true,
								httpStatus: undefined
							})
						})
					},
					ERROR: { actions: assign({ failed: true }) }
				},
				states: {
					running: { on: { CANCEL: { target: 'terminating', actions: 'cancel' } } },
					terminating: {
						entry: sendTo('process', { type: 'SIGTERM' }),
						after: { 5000: 'killing' },
						on: { CANCEL: {} }
					},
					killing: { entry: sendTo('process', { type: 'SIGKILL' }), on: { CANCEL: {} } }
				}
			},
			closed: { type: 'final', entry: assign({ input: undefined }) }
		}
	})
}
