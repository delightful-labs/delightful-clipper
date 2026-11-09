import type { EventPayload } from '../events.js'
import { types, createCallbackLogic, setup } from 'xstate'

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
	return { kind: 'failed' as const, code, status, retryable }
}
function workerFailure(code: string) {
	return code === 'ERR_WORKER_OUT_OF_MEMORY'
		? failure('sourceTooLarge', 413, false)
		: failure('gatewayUnavailable', 503, true)
}
const actors = {
	worker: createCallbackLogic<{ type: 'TERMINATE' }, WorkerOpen>(({ input, receive, sendBack }) => {
		let resource: WorkerResource
		try {
			resource = input(sendBack)
		} catch {
			sendBack({ type: 'WORKER_START_FAILED' as const })
			return
		}
		receive(() => resource.terminate())
		return () => resource.release()
	})
}
/** A reply is provisional until worker exit. Cancellation wins through termination. */
export const parserWorkerMachine = setup({
	schemas: {
		context: types<Context>(),
		events: {
			WORKER_RESULT: types<EventPayload<WorkerEvent | { type: 'CANCEL' }, 'WORKER_RESULT'>>(),
			WORKER_ERROR: types<EventPayload<WorkerEvent | { type: 'CANCEL' }, 'WORKER_ERROR'>>(),
			WORKER_EXIT: types<EventPayload<WorkerEvent | { type: 'CANCEL' }, 'WORKER_EXIT'>>(),
			WORKER_START_FAILED:
				types<EventPayload<WorkerEvent | { type: 'CANCEL' }, 'WORKER_START_FAILED'>>(),
			CANCEL: types<EventPayload<WorkerEvent | { type: 'CANCEL' }, 'CANCEL'>>()
		},
		input: types<{ open: WorkerOpen }>(),
		output: types<ParserReply>(),
		tags: types<string>(),
		children: { worker: types<import('xstate').ActorRefFrom<(typeof actors)['worker']>>() }
	},
	actors
}).createMachine({
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
				10000: (args) => {
					const { context } = args
					return {
						target: '.stopping',
						context: {
							failure:
								context.failure?.code === 'canceled'
									? context.failure
									: failure('parseTimeout', 504, true)
						}
					}
				}
			},
			on: {
				CANCEL: () => ({
					target: '.stopping',
					context: { failure: failure('canceled', 408, true) }
				}),
				WORKER_EXIT: { target: 'settled' },
				WORKER_START_FAILED: () => ({
					target: 'settled',
					context: { failure: failure('gatewayUnavailable', 503, true) }
				})
			},
			states: {
				running: {
					on: {
						WORKER_RESULT: (args) => {
							return { target: 'stopping', context: { reply: args.event.reply } }
						},
						WORKER_ERROR: (args) => {
							return { target: 'stopping', context: { failure: workerFailure(args.event.code) } }
						}
					}
				},
				stopping: {
					entry: (args, enq) => {
						enq.sendTo('worker', { type: 'TERMINATE' as const })
					},
					on: {
						WORKER_RESULT: {},
						WORKER_ERROR: (args) => {
							return {
								context: { failure: args.context.failure ?? workerFailure(args.event.code) }
							}
						}
					}
				}
			}
		},
		settled: {
			type: 'final' as const,
			entry: (args) => {
				const { context } = args
				return {
					context: {
						open: undefined,
						reply: undefined,
						failure: undefined,
						result: context.failure ?? context.reply ?? failure('gatewayUnavailable', 503, true)
					}
				}
			}
		}
	}
})
