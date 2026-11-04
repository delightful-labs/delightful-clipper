import { assign, enqueueActions, fromCallback, sendTo, setup } from 'xstate'
import type { ActorRefFrom, Snapshot } from 'xstate'
import type { Article, ArticleSaveResult } from '../../contracts/articles.js'
import type {
	QueueControl,
	QueueReport,
	WorkerInput,
	WorkerOutput
} from '../../contracts/article-worker.js'
import { createArticleWorkerCallMachine } from './article-worker-call.js'
import type { CallCapability, CallOutput, FailureResult, HostCall } from './article-worker-call.js'
export type HostResourceEvent =
	| { type: 'RESOURCE_READY' }
	| { type: 'RESOURCE_ERROR' }
	| { type: 'RESOURCE_CLOSED' }
	| { type: 'WORKER_MESSAGE'; message: WorkerOutput }
	| { type: 'PENDING_ROWS'; rows: Article[] }
	| { type: 'CONNECTIVITY'; online: boolean }
export type HostResourceCommand =
	| { type: 'POST'; message: WorkerInput }
	| { type: 'OBSERVE' | 'QUIESCE' | 'DISPOSE' }
export type HostResource = {
	post: (message: WorkerInput) => void
	observe: () => void
	quiesce: () => void
	dispose: () => void
}
export type HostInput = { report: (event: QueueReport) => void }
export type HostCapability<
	S extends Snapshot<ArticleSaveResult>,
	F extends Snapshot<FailureResult>
> = CallCapability<S, F> & {
	libraryId: string
	debug: boolean
	online: () => boolean
	open: (report: (event: HostResourceEvent) => void) => HostResource
}
/** Own worker admission, concurrent I/O children and drain-before-termination as modeled state. */
export function createArticleWorkerHostMachine<
	S extends Snapshot<ArticleSaveResult>,
	F extends Snapshot<FailureResult>
>(cap: HostCapability<S, F>) {
	const callMachine = createArticleWorkerCallMachine(cap)
	type Task = { id: string; retry: boolean; ref: ActorRefFrom<typeof callMachine> }
	type Context = {
		report: HostInput['report'] | undefined
		tasks: Record<string, Task>
		sequence: number
		online: boolean
	}
	type Event =
		| QueueControl
		| HostResourceEvent
		| { type: `xstate.done.actor.call:${string}`; actorId: string; output: CallOutput }
		| { type: `xstate.error.actor.call:${string}`; actorId: string; error: unknown }
	const actors = {
		resource: fromCallback<HostResourceCommand>(({ receive, sendBack }) => {
			let resource: HostResource | undefined
			try {
				resource = cap.open(sendBack)
				sendBack({ type: 'RESOURCE_READY' })
			} catch {
				sendBack({ type: 'RESOURCE_ERROR' })
			}
			receive((event) => {
				if (event.type === 'DISPOSE') {
					const current = resource
					resource = undefined
					try {
						current?.dispose()
					} catch {
						sendBack({ type: 'RESOURCE_ERROR' })
					} finally {
						sendBack({ type: 'RESOURCE_CLOSED' })
					}
					return
				}
				if (!resource) return
				try {
					if (event.type === 'POST') resource.post(event.message)
					if (event.type === 'OBSERVE') resource.observe()
					if (event.type === 'QUIESCE') resource.quiesce()
				} catch {
					sendBack({ type: 'RESOURCE_ERROR' })
				}
			})
			return () => resource?.dispose()
		}),
		call: callMachine
	}
	return setup<
		Context,
		Event,
		typeof actors,
		{},
		{
			startCall: undefined
			completeCall: undefined
			shutdownCalls: undefined
			reportError: undefined
		},
		{},
		never,
		string,
		HostInput
	>({
		actors,
		actions: {
			startCall: assign(({ context, event, spawn }) => {
				let call: HostCall
				if (event.type === 'RETRY') call = { type: 'RETRY', id: event.id }
				else if (event.type === 'WORKER_MESSAGE' && event.message.type === 'CALL')
					call = event.message
				else return {}
				const sequence = context.sequence + 1,
					key = `call:${sequence}`
				return {
					sequence,
					tasks: {
						...context.tasks,
						[key]: {
							id: call.id,
							retry: call.type === 'RETRY',
							ref: spawn('call', { id: key, input: call })
						}
					}
				}
			}),
			completeCall: enqueueActions(({ context, event, enqueue }) => {
				if (!('actorId' in event)) return
				const task = context.tasks[event.actorId]
				if (!task) return
				enqueue.stopChild(task.ref)
				enqueue.assign(({ context }) => ({
					tasks: Object.fromEntries(
						Object.entries(context.tasks).filter(([id]) => id !== event.actorId)
					)
				}))
			}),
			shutdownCalls: enqueueActions(({ context, enqueue }) => {
				for (const task of Object.values(context.tasks))
					enqueue.sendTo(task.ref, { type: 'SHUTDOWN' })
			}),
			reportError: ({ context }) => context.report?.({ type: 'BACKGROUND_ERROR' })
		}
	}).createMachine({
		id: 'article-worker-host',
		initial: 'owning',
		context: ({ input }) => ({
			report: input.report,
			tasks: {},
			sequence: 0,
			online: cap.online()
		}),
		states: {
			owning: {
				initial: 'opening',
				invoke: { id: 'resource', src: 'resource' },
				on: { STOP: '.draining', RESOURCE_ERROR: { target: '.draining', actions: 'reportError' } },
				states: {
					opening: {
						on: {
							RESOURCE_READY: {
								target: 'running',
								actions: [
									sendTo('resource', {
										type: 'POST',
										message: { type: 'INIT', libraryId: cap.libraryId, debug: cap.debug }
									}),
									sendTo('resource', { type: 'OBSERVE' })
								]
							}
						}
					},
					running: {
						on: {
							PENDING_ROWS: {
								guard: () => cap.isCurrent(),
								actions: sendTo('resource', ({ event }) => ({
									type: 'POST',
									message: { type: 'ROWS', rows: event.rows }
								}))
							},
							CONNECTIVITY: {
								actions: [
									enqueueActions(({ context, event, enqueue }) => {
										if (event.online && !context.online)
											enqueue.sendTo('resource', { type: 'POST', message: { type: 'WAKE' } })
									}),
									assign({ online: ({ event }) => event.online })
								]
							},
							WORKER_MESSAGE: {
								guard: () => cap.isCurrent(),
								actions: enqueueActions(({ context, event, enqueue }) => {
									const message = event.message
									if (message.type === 'CANCEL_CALL') {
										for (const task of Object.values(context.tasks))
											if (task.id === message.id) enqueue.sendTo(task.ref, { type: 'SHUTDOWN' })
									}
									if (message.type === 'STATUS')
										context.report?.({
											type: 'BACKGROUND_STATUS',
											id: message.id,
											message: message.message,
											cancelable: message.cancelable
										})
									if (message.type === 'CALL') enqueue('startCall')
								})
							},
							RETRY: { guard: () => cap.isCurrent(), actions: 'startCall' },
							CANCEL: {
								guard: () => cap.isCurrent(),
								actions: sendTo('resource', ({ event }) => ({ type: 'POST', message: event }))
							},
							WAKE: {
								guard: () => cap.isCurrent(),
								actions: sendTo('resource', { type: 'POST', message: { type: 'WAKE' } })
							},
							'xstate.done.actor.*': {
								actions: enqueueActions(({ context, event, enqueue }) => {
									if (
										!('output' in event) ||
										!('actorId' in event) ||
										!context.tasks[event.actorId]
									)
										return
									const task = context.tasks[event.actorId]
									if (!task) return
									const output = event.output
									if (cap.isCurrent()) {
										if (output.result)
											context.report?.({ type: 'BACKGROUND_SAVED', result: output.result })
										if (output.retry)
											enqueue.sendTo('resource', {
												type: 'POST',
												message: { type: 'RETRY', id: output.retry }
											})
										else if (output.reply)
											enqueue.sendTo('resource', {
												type: 'POST',
												message: { type: 'REPLY', id: output.id, reply: output.reply }
											})
										else if (output.error) {
											if (task.retry) context.report?.({ type: 'BACKGROUND_ERROR' })
											else if (task.id === output.id)
												enqueue.sendTo('resource', {
													type: 'POST',
													message: { type: 'ERROR', id: output.id, code: output.error }
												})
										}
									}
									enqueue('completeCall')
								})
							},
							'xstate.error.actor.*': {
								actions: [
									enqueueActions(({ context, event, enqueue }) => {
										if (!('actorId' in event)) return
										const task = context.tasks[event.actorId]
										if (!task) return
										if (cap.isCurrent()) {
											if (task.retry) context.report?.({ type: 'BACKGROUND_ERROR' })
											else
												enqueue.sendTo('resource', {
													type: 'POST',
													message: { type: 'ERROR', id: task.id, code: 'captureFailed' }
												})
										}
									}),
									'completeCall'
								]
							}
						}
					},
					releasing: {
						entry: sendTo('resource', { type: 'DISPOSE' }),
						on: {
							RESOURCE_CLOSED: '#article-worker-host.closed',
							RESOURCE_ERROR: { actions: 'reportError' },
							STOP: {}
						}
					},

					draining: {
						entry: [sendTo('resource', { type: 'QUIESCE' }), 'shutdownCalls'],
						always: {
							guard: ({ context }) => Object.keys(context.tasks).length === 0,
							target: 'releasing'
						},
						on: {
							STOP: {},
							RESOURCE_ERROR: {},
							'xstate.done.actor.*': { actions: 'completeCall' },
							'xstate.error.actor.*': { actions: 'completeCall' }
						}
					}
				}
			},
			closed: {
				type: 'final',
				entry: [
					({ context }) => context.report?.({ type: 'BACKGROUND_CLOSED' }),
					assign({ report: undefined, tasks: {} })
				]
			}
		}
	})
}
