import { createCallbackLogic, setup, types, type ActorFromLogic } from 'xstate'
import { createArticleQueueMachine } from './article-queue.js'
import type { Article } from '../../contracts/articles.js'
import type { QueueCapability } from '../../contracts/article-worker.js'

export type WorkerControl = { type: 'WAKE' } | { type: 'RETRY' | 'CANCEL'; id: string }
export type SharedControl =
	| { type: 'COMMAND'; id: string; control: WorkerControl }
	| { type: 'ACK'; id: string }
type Command = Extract<SharedControl, { type: 'COMMAND' }>
export type RuntimeEvent =
	| { type: 'ROWS'; rows: Article[] }
	| { type: 'STOP' }
	| WorkerControl
	| { type: 'LOCKED' | 'LOCK_FAILED' }
	| { type: 'SHARED'; message: SharedControl }
	| { type: 'COMMAND_CREATED'; command: Command }
export type RuntimeCapability = {
	queue: QueueCapability
	claim: (report: (event: { type: 'LOCKED' | 'LOCK_FAILED' }) => void) => {
		cancel: () => void
		release: () => void
	}
	channel: (report: (message: SharedControl) => void) => {
		post: (message: SharedControl) => void
		close: () => void
	}
	commandId: () => string
	failed: () => void
}
/** Retain the lock until the host has drained native writes and terminates this worker. */
export function createArticleWorkerRuntimeMachine(cap: RuntimeCapability) {
	const queue = createArticleQueueMachine(cap.queue)
	type Context = {
		rows: Article[]
		pending: Record<string, Command>
		queue: ActorFromLogic<typeof queue> | undefined
	}
	const actors = {
		queue,
		commands: createCallbackLogic<WorkerControl>(({ receive, sendBack }) => {
			receive((control) =>
				sendBack({
					type: 'COMMAND_CREATED',
					command: { type: 'COMMAND', id: cap.commandId(), control }
				})
			)
		}),
		lock: createCallbackLogic<{ type: 'CANCEL_ACQUIRE' }>(({ receive, sendBack }) => {
			let lease: ReturnType<RuntimeCapability['claim']> | undefined
			try {
				lease = cap.claim(sendBack)
			} catch {
				sendBack({ type: 'LOCK_FAILED' })
			}
			receive(() => lease?.cancel())
			return () => lease?.release()
		}),
		channel: createCallbackLogic<{ type: 'PUBLISH'; message: SharedControl }>(
			({ receive, sendBack }) => {
				let channel: ReturnType<RuntimeCapability['channel']> | undefined
				try {
					channel = cap.channel((message) => sendBack({ type: 'SHARED', message }))
				} catch {
					sendBack({ type: 'LOCK_FAILED' })
				}
				receive((event) => {
					try {
						channel?.post(event.message)
					} catch {
						sendBack({ type: 'LOCK_FAILED' })
					}
				})
				return () => channel?.close()
			}
		)
	}
	return setup({
		schemas: {
			context: types<Context>(),
			events: {
				ROWS: types<{ rows: Article[] }>(),
				STOP: types(),
				WAKE: types(),
				RETRY: types<{ id: string }>(),
				CANCEL: types<{ id: string }>(),
				LOCKED: types(),
				LOCK_FAILED: types(),
				SHARED: types<{ message: SharedControl }>(),
				COMMAND_CREATED: types<{ command: Command }>()
			},
			children: {
				lock: types<import('xstate').ActorRefFrom<typeof actors.lock>>(),
				channel: types<import('xstate').ActorRefFrom<typeof actors.channel>>(),
				commands: types<import('xstate').ActorRefFrom<typeof actors.commands>>()
			}
		},
		actors
	}).createMachine({
		id: 'article-worker-runtime',
		initial: 'owning',
		context: { rows: [], pending: {}, queue: undefined },
		states: {
			owning: {
				invoke: [
					{ id: 'lock', src: 'lock' },
					{ id: 'channel', src: 'channel' },
					{ id: 'commands', src: 'commands' }
				],
				initial: 'waitingForLock',
				on: {
					STOP: { target: '.stopped' },
					LOCK_FAILED: (_, enq) => {
						enq(cap.failed)
						return { target: '.stopped' }
					}
				},
				states: {
					waitingForLock: {
						on: {
							ROWS: ({ event }) => ({ context: { rows: event.rows } }),
							RETRY: ({ event }, enq) => enq.sendTo('commands', event),
							CANCEL: ({ event }, enq) => enq.sendTo('commands', event),
							WAKE: ({ event }, enq) => enq.sendTo('commands', event),
							COMMAND_CREATED: ({ context, event }, enq) => {
								enq.sendTo('channel', { type: 'PUBLISH', message: event.command })
								return {
									context: { pending: { ...context.pending, [event.command.id]: event.command } }
								}
							},
							SHARED: ({ context, event }) => {
								if (event.message.type !== 'ACK') return
								return {
									context: {
										pending: Object.fromEntries(
											Object.entries(context.pending).filter(([id]) => id !== event.message.id)
										)
									}
								}
							},
							LOCKED: { target: 'active' }
						}
					},
					active: {
						entry: ({ context }, enq) => {
							const actor = enq.spawn('queue', {})
							enq.sendTo(actor, { type: 'ROWS', rows: context.rows })
							for (const command of Object.values(context.pending))
								enq.sendTo(actor, command.control)
							return { context: { queue: actor, pending: {} } }
						},
						exit: ({ context }, enq) => enq.sendTo(context.queue, { type: 'STOP' }),
						on: {
							ROWS: ({ context, event }, enq) => {
								enq.sendTo(context.queue, event)
								return { context: { rows: event.rows } }
							},
							RETRY: ({ context, event }, enq) => enq.sendTo(context.queue, event),
							CANCEL: ({ context, event }, enq) => enq.sendTo(context.queue, event),
							WAKE: ({ context, event }, enq) => enq.sendTo(context.queue, event),
							COMMAND_CREATED: ({ context, event }, enq) => {
								enq.sendTo(context.queue, event.command.control)
								enq.sendTo('channel', { type: 'PUBLISH', message: event.command })
							},
							SHARED: ({ context, event }, enq) => {
								if (event.message.type !== 'COMMAND') return
								enq.sendTo(context.queue, event.message.control)
								enq.sendTo('channel', {
									type: 'PUBLISH',
									message: { type: 'ACK', id: event.message.id }
								})
							}
						}
					},
					stopped: {
						entry: ({ context }, enq) => {
							enq.sendTo('lock', { type: 'CANCEL_ACQUIRE' })
							enq.stop(context.queue)
							return { context: { queue: undefined, rows: [], pending: {} } }
						}
					}
				}
			}
		}
	})
}
