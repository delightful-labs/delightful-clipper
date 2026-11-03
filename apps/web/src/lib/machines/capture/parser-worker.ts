import { assign, fromCallback, sendTo, setup } from 'xstate'
import type { ParserReply } from '../../server/capture/parser-protocol.js'
export type WorkerEvent =
	| { type: 'WORKER_RESULT'; reply: ParserReply }
	| { type: 'WORKER_ERROR'; code: string }
	| { type: 'WORKER_EXIT' }
	| { type: 'WORKER_START_FAILED' }
export type WorkerResource = { terminate: () => void; release: () => void }
export type WorkerOpen = (report: (event: WorkerEvent) => void) => WorkerResource
type Failure = Extract<ParserReply, { kind: 'failed' }>
type Context = {
	open: WorkerOpen | undefined
	reply: ParserReply | undefined
	failure: Failure | undefined
	result: ParserReply | undefined
}
function failure(code: string, status: number, retryable: boolean): Failure {
	return { kind: 'failed', code, status, retryable }
}
function workerFailure(code: string) {
	return code === 'ERR_WORKER_OUT_OF_MEMORY'
		? failure('sourceTooLarge', 413, false)
		: failure('gatewayUnavailable', 503, true)
}
const actors = {
	worker: fromCallback<{ type: 'TERMINATE' }, WorkerOpen>(({ input, receive, sendBack }) => {
		let resource: WorkerResource
		try {
			resource = input(sendBack)
		} catch {
			sendBack({ type: 'WORKER_START_FAILED' })
			return
		}
		receive(() => resource.terminate())
		return () => resource.release()
	})
}
/** A reply is provisional until worker exit. Cancellation wins through termination. */
export const parserWorkerMachine = setup<
	Context,
	WorkerEvent | { type: 'CANCEL' },
	typeof actors,
	{},
	{},
	{},
	never,
	string,
	{ open: WorkerOpen },
	ParserReply
>({ actors }).createMachine({
	id: 'parser-worker',
	initial: 'active',
	context: ({ input }) => ({
		open: input.open,
		reply: undefined,
		failure: undefined,
		result: undefined
	}),
	output: ({ context }) => {
		if (!context.result) throw new Error('Missing parser outcome')
		return context.result
	},
	states: {
		active: {
			initial: 'running',
			invoke: {
				id: 'worker',
				src: 'worker',
				input: ({ context }: { context: Context }) => {
					if (!context.open) throw new Error('Missing worker resource')
					return context.open
				}
			},
			after: {
				10000: {
					target: '.stopping',
					actions: assign({
						failure: ({ context }) =>
							context.failure?.code === 'canceled'
								? context.failure
								: failure('parseTimeout', 504, true)
					})
				}
			},
			on: {
				CANCEL: {
					target: '.stopping',
					actions: assign({ failure: failure('canceled', 408, true) })
				},
				WORKER_EXIT: 'settled',
				WORKER_START_FAILED: {
					target: 'settled',
					actions: assign({ failure: failure('gatewayUnavailable', 503, true) })
				}
			},
			states: {
				running: {
					on: {
						WORKER_RESULT: {
							target: 'stopping',
							actions: assign({ reply: ({ event }) => event.reply })
						},
						WORKER_ERROR: {
							target: 'stopping',
							actions: assign({ failure: ({ event }) => workerFailure(event.code) })
						}
					}
				},
				stopping: {
					entry: sendTo('worker', { type: 'TERMINATE' }),
					on: {
						WORKER_RESULT: {},
						WORKER_ERROR: {
							actions: assign({
								failure: ({ context, event }) => context.failure ?? workerFailure(event.code)
							})
						}
					}
				}
			}
		},
		settled: {
			type: 'final',
			entry: assign(({ context }) => ({
				open: undefined,
				reply: undefined,
				failure: undefined,
				result: context.failure ?? context.reply ?? failure('gatewayUnavailable', 503, true)
			}))
		}
	}
})
