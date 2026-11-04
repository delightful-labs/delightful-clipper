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
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing host result')
	return value
}
function statusMessage(message: WorkerOutput) {
	if (message.type !== 'STATUS') throw new Error('Expected worker status')
	return message
}
function cancellationMessage(message: WorkerOutput) {
	if (message.type !== 'CANCEL_CALL') throw new Error('Expected worker cancellation')
	return message
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
	const task = (context: Context, event: Event) =>
		'actorId' in event ? context.tasks[event.actorId] : undefined
	const validCompletion = (context: Context, event: Event) =>
		cap.isCurrent() && 'output' in event && !!task(context, event)
	const completion = (event: Event): CallOutput => {
		if (!('output' in event)) throw new Error('Expected completed call')
		return event.output
	}
	const output = fromCallback<{ type: 'REPORT'; event: QueueReport }, HostInput['report']>(
		({ input, receive }) => receive((event) => input(event.event))
	)
	const actors = {
		output,
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
			reply: undefined
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
			reportError: sendTo('output', { type: 'REPORT', event: { type: 'BACKGROUND_ERROR' } }),
			reply: sendTo('resource', ({ event }) => ({
				type: 'POST',
				message: {
					type: 'REPLY',
					id: completion(event).id,
					reply: required(completion(event).reply)
				}
			}))
		}
	}).createMachine({
		id: 'article-worker-host',
		initial: 'owning',
		invoke: {
			id: 'output',
			src: 'output',
			input: ({ context }: { context: Context }) => required(context.report)
		},
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
							CONNECTIVITY: [
								{
									guard: ({ context, event }) => event.online && !context.online,
									actions: [
										sendTo('resource', { type: 'POST', message: { type: 'WAKE' } }),
										assign({ online: ({ event }) => event.online })
									]
								},
								{ actions: assign({ online: ({ event }) => event.online }) }
							],
							WORKER_MESSAGE: [
								{
									guard: ({ event }) => cap.isCurrent() && event.message.type === 'CANCEL_CALL',
									actions: enqueueActions(({ context, event, enqueue }) => {
										const id = cancellationMessage(event.message).id
										for (const task of Object.values(context.tasks).filter(
											(task) => task.id === id
										))
											enqueue.sendTo(task.ref, { type: 'SHUTDOWN' })
									})
								},
								{
									guard: ({ event }) => cap.isCurrent() && event.message.type === 'STATUS',
									actions: sendTo('output', ({ event }) => {
										const message = statusMessage(event.message)
										return {
											type: 'REPORT',
											event: {
												type: 'BACKGROUND_STATUS',
												id: message.id,
												message: message.message,
												cancelable: message.cancelable
											}
										}
									})
								},
								{
									guard: ({ event }) => cap.isCurrent() && event.message.type === 'CALL',
									actions: 'startCall'
								}
							],
							RETRY: { guard: () => cap.isCurrent(), actions: 'startCall' },
							CANCEL: {
								guard: () => cap.isCurrent(),
								actions: sendTo('resource', ({ event }) => ({ type: 'POST', message: event }))
							},
							WAKE: {
								guard: () => cap.isCurrent(),
								actions: sendTo('resource', { type: 'POST', message: { type: 'WAKE' } })
							},
							'xstate.done.actor.*': [
								{
									guard: ({ context, event }) =>
										validCompletion(context, event) && !!completion(event).retry,
									actions: [
										sendTo('resource', ({ event }) => ({
											type: 'POST',
											message: { type: 'RETRY', id: required(completion(event).retry) }
										})),
										'completeCall'
									]
								},
								{
									guard: ({ context, event }) =>
										validCompletion(context, event) &&
										!!completion(event).reply &&
										!!completion(event).result,
									actions: [
										sendTo('output', ({ event }) => ({
											type: 'REPORT',
											event: {
												type: 'BACKGROUND_SAVED',
												result: required(completion(event).result)
											}
										})),
										'reply',
										'completeCall'
									]
								},
								{
									guard: ({ context, event }) =>
										validCompletion(context, event) && !!completion(event).reply,
									actions: ['reply', 'completeCall']
								},
								{
									guard: ({ context, event }) =>
										validCompletion(context, event) &&
										!!completion(event).error &&
										!!task(context, event)?.retry,
									actions: ['reportError', 'completeCall']
								},
								{
									guard: ({ context, event }) =>
										validCompletion(context, event) &&
										!!completion(event).error &&
										task(context, event)?.id === completion(event).id,
									actions: [
										sendTo('resource', ({ event }) => ({
											type: 'POST',
											message: {
												type: 'ERROR',
												id: completion(event).id,
												code: required(completion(event).error)
											}
										})),
										'completeCall'
									]
								},
								{ actions: 'completeCall' }
							],
							'xstate.error.actor.*': [
								{
									guard: ({ context, event }) => cap.isCurrent() && !!task(context, event)?.retry,
									actions: ['reportError', 'completeCall']
								},
								{
									guard: ({ context, event }) => cap.isCurrent() && !!task(context, event),
									actions: [
										sendTo('resource', ({ context, event }) => ({
											type: 'POST',
											message: {
												type: 'ERROR',
												id: required(task(context, event)).id,
												code: 'captureFailed'
											}
										})),
										'completeCall'
									]
								},
								{ actions: 'completeCall' }
							]
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
					sendTo('output', { type: 'REPORT', event: { type: 'BACKGROUND_CLOSED' } }),
					assign({ report: undefined, tasks: {} })
				]
			}
		}
	})
}
