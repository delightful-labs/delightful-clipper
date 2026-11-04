import { assign, enqueueActions, fromCallback, setup } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import { createArticleQueueMachine } from './article-queue.js'
import type { Article } from '../../contracts/articles.js'
import type { QueueCapability } from '../../contracts/article-worker.js'
export type WorkerControl = { type: 'WAKE' } | { type: 'RETRY' | 'CANCEL'; id: string }
export type SharedControl =
	| { type: 'COMMAND'; id: string; control: WorkerControl }
	| { type: 'ACK'; id: string }
export type RuntimeEvent =
	| { type: 'ROWS'; rows: Article[] }
	| { type: 'STOP' }
	| WorkerControl
	| { type: 'LOCKED' | 'LOCK_FAILED' }
	| { type: 'SHARED'; message: SharedControl }
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
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing active queue')
	return value
}
/** The lock stays invoked after STOP; the host drains native writes before terminating this worker. */
export function createArticleWorkerRuntimeMachine(cap: RuntimeCapability) {
	const queue = createArticleQueueMachine(cap.queue)
	type Command = Extract<SharedControl, { type: 'COMMAND' }>
	type Context = {
		rows: Article[]
		pending: Record<string, Command>
		queue: ActorRefFrom<typeof queue> | undefined
	}
	const actors = {
		queue,
		lock: fromCallback<{ type: 'CANCEL_ACQUIRE' }>(({ receive, sendBack }) => {
			let lease: ReturnType<RuntimeCapability['claim']> | undefined
			try {
				lease = cap.claim(sendBack)
			} catch {
				sendBack({ type: 'LOCK_FAILED' })
			}
			receive(() => lease?.cancel())
			return () => lease?.release()
		}),
		channel: fromCallback<{ type: 'PUBLISH'; message: SharedControl }>(({ receive, sendBack }) => {
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
		})
	}
	return setup<
		Context,
		RuntimeEvent,
		typeof actors,
		{},
		{ retain: undefined; apply: undefined; applyShared: undefined },
		{},
		never,
		string
	>({
		actors,
		actions: {
			retain: enqueueActions(({ event, enqueue }) => {
				if (event.type !== 'RETRY' && event.type !== 'CANCEL' && event.type !== 'WAKE') return
				const control: WorkerControl =
					event.type === 'WAKE' ? { type: 'WAKE' } : { type: event.type, id: event.id }
				const command: Command = { type: 'COMMAND', id: cap.commandId(), control }
				enqueue.assign(({ context }) => ({
					pending: { ...context.pending, [command.id]: command }
				}))
				enqueue.sendTo('channel', { type: 'PUBLISH', message: command })
			}),
			apply: enqueueActions(({ context, event, enqueue }) => {
				if (event.type !== 'WAKE' && event.type !== 'CANCEL' && event.type !== 'RETRY')
					throw new Error('Expected direct worker control')
				enqueue.sendTo(required(context.queue), event)
			}),
			applyShared: enqueueActions(({ context, event, enqueue }) => {
				if (event.type !== 'SHARED' || event.message.type !== 'COMMAND')
					throw new Error('Expected shared command')
				enqueue.sendTo(required(context.queue), event.message.control)
				enqueue.sendTo('channel', {
					type: 'PUBLISH',
					message: { type: 'ACK', id: event.message.id }
				})
			})
		}
	}).createMachine({
		id: 'article-worker-runtime',
		initial: 'owning',
		context: { rows: [], pending: {}, queue: undefined },
		states: {
			owning: {
				invoke: [
					{ id: 'lock', src: 'lock' },
					{ id: 'channel', src: 'channel' }
				],
				initial: 'waitingForLock',
				on: { STOP: '.stopped', LOCK_FAILED: { target: '.stopped', actions: () => cap.failed() } },
				states: {
					waitingForLock: {
						on: {
							ROWS: { actions: assign({ rows: ({ event }) => event.rows }) },
							RETRY: { actions: 'retain' },
							CANCEL: { actions: 'retain' },
							WAKE: { actions: 'retain' },
							SHARED: {
								guard: ({ event }) => event.message.type === 'ACK',
								actions: assign(({ context, event }) => ({
									pending: Object.fromEntries(
										Object.entries(context.pending).filter(([id]) => id !== event.message.id)
									)
								}))
							},
							LOCKED: 'active'
						}
					},
					active: {
						exit: enqueueActions(({ context, enqueue }) => {
							enqueue.sendTo(required(context.queue), { type: 'STOP' })
						}),
						entry: [
							assign({ queue: ({ spawn }) => spawn('queue', {}) }),
							enqueueActions(({ context, enqueue }) => {
								const queue = required(context.queue)
								enqueue.sendTo(queue, { type: 'ROWS', rows: context.rows })
								for (const command of Object.values(context.pending))
									enqueue.sendTo(queue, command.control)
								enqueue.assign({ pending: {} })
							})
						],
						on: {
							ROWS: {
								actions: [
									assign({ rows: ({ event }) => event.rows }),
									enqueueActions(({ context, event, enqueue }) => {
										enqueue.sendTo(required(context.queue), event)
									})
								]
							},
							RETRY: { actions: 'apply' },
							CANCEL: { actions: 'apply' },
							WAKE: { actions: 'apply' },
							SHARED: {
								guard: ({ event }) => event.message.type === 'COMMAND',
								actions: 'applyShared'
							}
						}
					},
					stopped: {
						entry: enqueueActions(({ enqueue }) => {
							enqueue.sendTo('lock', { type: 'CANCEL_ACQUIRE' })
							enqueue.assign({ rows: [], pending: {}, queue: undefined })
						}),
						on: { STOP: {}, LOCK_FAILED: {}, LOCKED: {} }
					}
				}
			}
		}
	})
}
