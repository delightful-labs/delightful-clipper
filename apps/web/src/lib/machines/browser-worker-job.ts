import { createCallbackLogic, setup, types } from 'xstate'
import { monotonicNow } from '../contracts/resource-waits.js'

export type BrowserJobWorker = Pick<
	Worker,
	'postMessage' | 'terminate' | 'onmessage' | 'onerror' | 'onmessageerror'
>
export type BrowserWorkerJobInput<Request, Reply> = {
	open: () => BrowserJobWorker
	message: Request
	decode: (value: unknown) => Reply
	transfer?: Transferable[]
	signal?: AbortSignal
	now?: () => number
}
export type BrowserWorkerJobResult<Reply> = (
	| { kind: 'replied'; reply: Reply }
	| { kind: 'failed'; reason: 'construction' | 'post' | 'worker' | 'message' | 'reply' }
	| { kind: 'cancelled' }
) & { elapsedMs: number }

/** One selected browser operation. The caller owns its deadline and domain
 * fallback. A reply is delivered only after handlers/abort listeners are removed
 * and native terminate() returns; browsers provide no asynchronous exit receipt. */
export function createBrowserWorkerJob<Request, Reply>() {
	type Input = BrowserWorkerJobInput<Request, Reply>
	type Result = BrowserWorkerJobResult<Reply>
	type Context = { input: Input; result: Result }
	const native = createCallbackLogic<{ type: 'OPEN' | 'POST' | 'RELEASE' }, Input>(
		({ input, receive, sendBack }) => {
			const now = input.now ?? monotonicNow,
				startedAt = now()
			let worker: BrowserJobWorker | undefined
			let released = false
			const cancelled = () => sendBack({ type: 'CANCEL' })
			const report = (value: unknown) => {
				if (released) return
				try {
					sendBack({ type: 'REPLIED', reply: input.decode(value) })
				} catch {
					sendBack({ type: 'FAILED', reason: 'reply' })
				}
			}
			const release = () => {
				if (released) return
				released = true
				input.signal?.removeEventListener('abort', cancelled)
				if (worker) {
					worker.onmessage = null
					worker.onerror = null
					worker.onmessageerror = null
					worker.terminate()
					worker = undefined
				}
			}
			receive((event) => {
				if (released) return
				if (event.type === 'OPEN') {
					try {
						worker = input.open()
						worker.onmessage = ({ data }: MessageEvent<unknown>) => report(data)
						worker.onerror = () => {
							if (!released) sendBack({ type: 'FAILED', reason: 'worker' })
						}
						worker.onmessageerror = () => {
							if (!released) sendBack({ type: 'FAILED', reason: 'message' })
						}
						sendBack({ type: 'OPENED' })
					} catch {
						sendBack({ type: 'FAILED', reason: 'construction' })
					}
				} else if (event.type === 'POST') {
					try {
						worker!.postMessage(input.message, input.transfer ?? [])
						sendBack({ type: 'POSTED' })
					} catch {
						sendBack({ type: 'FAILED', reason: 'post' })
					}
				} else {
					try {
						release()
						sendBack({ type: 'RELEASED', elapsedMs: now() - startedAt })
					} catch {
						sendBack({ type: 'RELEASE_FAILED' })
					}
				}
			})
			input.signal?.addEventListener('abort', cancelled, { once: true })
			sendBack({ type: 'ADMITTED', aborted: input.signal?.aborted === true })
			return () => {
				try {
					release()
				} catch {
					/* Forced stop cannot acknowledge cleanup. */
				}
			}
		}
	)
	return setup({
		schemas: {
			input: types<Input>(),
			context: types<Context>(),
			output: types<Result>(),
			events: {
				CANCEL: types(),
				ADMITTED: types<{ aborted: boolean }>(),
				OPENED: types(),
				POSTED: types(),
				REPLIED: types<{ reply: Reply }>(),
				FAILED: types<{ reason: Extract<Result, { kind: 'failed' }>['reason'] }>(),
				RELEASED: types<{ elapsedMs: number }>(),
				RELEASE_FAILED: types()
			},
			children: { native: types<import('xstate').ActorRefFrom<typeof native>>() }
		},
		actors: { native },
		guards: { alreadyAborted: (_args, event: { aborted: boolean }) => event.aborted }
	}).createMachine({
		id: 'browser-worker-job',
		initial: 'admitting',
		context: ({ input }) => ({ input, result: { kind: 'cancelled', elapsedMs: 0 } }),
		output: ({ context }) => context.result,
		invoke: {
			id: 'native',
			src: 'native',
			input: ({ context }) => context.input,
			onError: { target: '.blocked' }
		},
		on: {
			CANCEL: { target: '.cleaning', context: { result: { kind: 'cancelled', elapsedMs: 0 } } }
		},
		states: {
			admitting: {
				on: {
					ADMITTED: (args) =>
						args.guards.alreadyAborted(args, args.event)
							? { target: 'cleaning' }
							: { target: 'working' }
				}
			},
			working: {
				initial: 'opening',
				on: {
					FAILED: ({ event }) => ({
						target: 'cleaning',
						context: { result: { kind: 'failed', reason: event.reason, elapsedMs: 0 } }
					})
				},
				states: {
					opening: {
						entry: (_args, enq) => {
							enq.sendTo('native', { type: 'OPEN' })
						},
						on: { OPENED: { target: 'posting' } }
					},
					posting: {
						entry: (_args, enq) => {
							enq.sendTo('native', { type: 'POST' })
						},
						on: {
							POSTED: { target: 'waiting' },
							REPLIED: ({ event }) => ({
								target: '#browser-worker-job.cleaning',
								context: { result: { kind: 'replied', reply: event.reply, elapsedMs: 0 } }
							})
						}
					},
					waiting: {
						on: {
							REPLIED: ({ event }) => ({
								target: '#browser-worker-job.cleaning',
								context: { result: { kind: 'replied', reply: event.reply, elapsedMs: 0 } }
							})
						}
					}
				}
			},
			cleaning: {
				entry: (_args, enq) => {
					enq.sendTo('native', { type: 'RELEASE' })
				},
				on: {
					CANCEL: {},
					REPLIED: {},
					FAILED: {},
					POSTED: {},
					OPENED: {},
					ADMITTED: {},
					RELEASED: ({ context, event }) => ({
						target: 'settled',
						context: { result: { ...context.result, elapsedMs: event.elapsedMs } }
					}),
					RELEASE_FAILED: { target: 'blocked' }
				}
			},
			blocked: {
				on: { CANCEL: {}, REPLIED: {}, FAILED: {}, POSTED: {}, OPENED: {}, ADMITTED: {} }
			},
			settled: { type: 'final' }
		}
	})
}
