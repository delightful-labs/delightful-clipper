import type { EventPayload } from '../events.js'
import { types, createCallbackLogic, setup } from 'xstate'

import type { Article } from '../../contracts/articles.js'
import type {
	QueueControl,
	QueueReport,
	WorkerInput,
	WorkerOutput
} from '../../contracts/article-worker.js'
import { createArticleWorkerCallMachine } from './article-worker-call.js'
import type { CallCapability, CallOutput, HostCall } from './article-worker-call.js'
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
export type HostCapability = CallCapability & {
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
export function createArticleWorkerHostMachine(cap: HostCapability) {
	const callMachine = createArticleWorkerCallMachine(cap)
	type Task = {
		id: string
		retry: boolean
		ref: import('xstate').ActorFromLogic<typeof callMachine>
	}
	type Context = {
		report: HostInput['report'] | undefined
		tasks: Record<string, Task>
		sequence: number
		online: boolean
	}
	type Event =
		| QueueControl
		| HostResourceEvent
		| { type: 'CALL_DONE'; actorId: string; output: CallOutput }
		| { type: 'CALL_ERROR'; actorId: string; error: unknown }
	const task = (context: Context, event: Event) =>
		'actorId' in event ? context.tasks[event.actorId] : undefined
	const validCompletion = (context: Context, event: Event) =>
		cap.isCurrent() && 'output' in event && !!task(context, event)
	const completion = (event: Event): CallOutput => {
		if (!('output' in event)) throw new Error('Expected completed call')
		return event.output
	}
	const output = createCallbackLogic<{ type: 'REPORT'; event: QueueReport }, HostInput['report']>(
		({ input, receive }) => receive((event) => input(event.event))
	)
	const actors = {
		output,
		resource: createCallbackLogic<HostResourceCommand>(({ receive, sendBack }) => {
			let resource: HostResource | undefined
			try {
				resource = cap.open(sendBack)
				sendBack({ type: 'RESOURCE_READY' as const })
			} catch {
				sendBack({ type: 'RESOURCE_ERROR' as const })
			}
			receive((event) => {
				if (event.type === 'DISPOSE') {
					const current = resource
					resource = undefined
					try {
						current?.dispose()
					} catch {
						sendBack({ type: 'RESOURCE_ERROR' as const })
					} finally {
						sendBack({ type: 'RESOURCE_CLOSED' as const })
					}
					return
				}
				if (!resource) return
				try {
					if (event.type === 'POST') resource.post(event.message)
					if (event.type === 'OBSERVE') resource.observe()
					if (event.type === 'QUIESCE') resource.quiesce()
				} catch {
					sendBack({ type: 'RESOURCE_ERROR' as const })
				}
			})
			return () => resource?.dispose()
		}),
		call: callMachine
	}
	return setup({
		schemas: {
			context: types<Context>(),
			events: {
				CALL_DONE: types<{ actorId: string; output: CallOutput }>(),
				CALL_ERROR: types<{ actorId: string; error: unknown }>(),
				STOP: types<EventPayload<Event, 'STOP'>>(),
				WAKE: types<EventPayload<Event, 'WAKE'>>(),
				RETRY: types<EventPayload<Event, 'RETRY'>>(),
				CANCEL: types<EventPayload<Event, 'CANCEL'>>(),
				RESOURCE_READY: types<EventPayload<Event, 'RESOURCE_READY'>>(),
				RESOURCE_ERROR: types<EventPayload<Event, 'RESOURCE_ERROR'>>(),
				RESOURCE_CLOSED: types<EventPayload<Event, 'RESOURCE_CLOSED'>>(),
				WORKER_MESSAGE: types<EventPayload<Event, 'WORKER_MESSAGE'>>(),
				PENDING_ROWS: types<EventPayload<Event, 'PENDING_ROWS'>>(),
				CONNECTIVITY: types<EventPayload<Event, 'CONNECTIVITY'>>()
			},
			input: types<HostInput>(),
			tags: types<string>(),
			children: {
				output: types<import('xstate').ActorRefFrom<(typeof actors)['output']>>(),
				resource: types<import('xstate').ActorRefFrom<(typeof actors)['resource']>>(),
				call: types<import('xstate').ActorRefFrom<(typeof actors)['call']>>()
			}
		},
		actors,
		actions: {
			startCall: ({
				context,
				event,
				spawn
			}: {
				context: Context
				event: Event
				spawn: (
					src: 'call',
					options: { id: string; input: HostCall }
				) => import('xstate').ActorFromLogic<typeof callMachine>
			}) => {
				let call: HostCall
				if (event.type === 'RETRY') call = { type: 'RETRY' as const, id: event.id }
				else if (event.type === 'WORKER_MESSAGE' && event.message.type === 'CALL')
					call = event.message
				else return { context: {} }
				const sequence = context.sequence + 1,
					key = `call:${sequence}`
				return {
					context: {
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
				}
			}
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
				on: {
					STOP: { target: '.draining' },
					RESOURCE_ERROR: (args, enq) => {
						enq.sendTo('output', {
							type: 'REPORT' as const,
							event: { type: 'BACKGROUND_ERROR' as const }
						})
						return { target: '.draining' }
					}
				},
				states: {
					opening: {
						on: {
							RESOURCE_READY: (args, enq) => {
								enq.sendTo('resource', {
									type: 'POST' as const,
									message: { type: 'INIT' as const, libraryId: cap.libraryId, debug: cap.debug }
								})
								enq.sendTo('resource', { type: 'OBSERVE' as const })
								return { target: 'running' }
							}
						}
					},
					running: {
						on: {
							PENDING_ROWS: (args, enq) => {
								if (!cap.isCurrent()) return
								enq.sendTo('resource', {
									type: 'POST' as const,
									message: { type: 'ROWS' as const, rows: args.event.rows }
								})
							},
							CONNECTIVITY: (args, enq) => {
								const { event } = args
								if (event.online && !args.context.online) {
									enq.sendTo('resource', {
										type: 'POST' as const,
										message: { type: 'WAKE' as const }
									})
									return { context: { online: event.online } }
								}
								return { context: { online: event.online } }
							},
							WORKER_MESSAGE: (args, enq) => {
								const { event } = args
								if (cap.isCurrent() && event.message.type === 'CANCEL_CALL') {
									{
										const id = cancellationMessage(event.message).id
										for (const task of Object.values(args.context.tasks).filter(
											(task) => task.id === id
										))
											enq.sendTo(task.ref, { type: 'SHUTDOWN' as const })
									}
									return {}
								}
								if (cap.isCurrent() && event.message.type === 'STATUS') {
									enq.sendTo(
										'output',
										(({ event }) => {
											const message = statusMessage(event.message)
											return {
												type: 'REPORT' as const,
												event: {
													type: 'BACKGROUND_STATUS' as const,
													id: message.id,
													message: message.message,
													cancelable: message.cancelable
												}
											}
										})(args)
									)
									return {}
								}
								if (cap.isCurrent() && event.message.type === 'CALL') {
									return {
										context: args.actions.startCall({
											...args,
											spawn: (src, options) => {
												const ref = enq.spawn(src, options)
												enq.subscribeTo(ref, {
													done: (output): Event => ({ type: 'CALL_DONE', actorId: ref.id, output }),
													error: (error): Event => ({ type: 'CALL_ERROR', actorId: ref.id, error })
												})
												return ref
											}
										}).context
									}
								}
							},
							RETRY: (args, enq) => {
								if (!cap.isCurrent()) return
								return {
									context: args.actions.startCall({
										...args,
										spawn: (src, options) => {
											const ref = enq.spawn(src, options)
											enq.subscribeTo(ref, {
												done: (output): Event => ({ type: 'CALL_DONE', actorId: ref.id, output }),
												error: (error): Event => ({ type: 'CALL_ERROR', actorId: ref.id, error })
											})
											return ref
										}
									}).context
								}
							},
							CANCEL: (args, enq) => {
								if (!cap.isCurrent()) return
								const { event } = args
								enq.sendTo('resource', { type: 'POST' as const, message: event })
							},
							WAKE: (args, enq) => {
								if (!cap.isCurrent()) return
								enq.sendTo('resource', {
									type: 'POST' as const,
									message: { type: 'WAKE' as const }
								})
							},
							CALL_DONE: (args, enq) => {
								let pendingContext = {}

								const { context, event } = args
								if (validCompletion(context, event) && !!completion(event).retry) {
									enq.sendTo('resource', {
										type: 'POST' as const,
										message: { type: 'RETRY' as const, id: required(completion(event).retry) }
									})
									{
										if (!('actorId' in event)) throw new Error('Expected child completion')
										const task = context.tasks[event.actorId]
										if (task) enq.stop(task.ref)
										pendingContext = {
											...pendingContext,
											...(({ context }) => ({
												tasks: Object.fromEntries(
													Object.entries(context.tasks).filter(([id]) => id !== event.actorId)
												)
											}))({
												...args,
												context: { ...args.context, ...pendingContext },
												spawn: enq.spawn
											})
										}
									}
									return { context: pendingContext }
								}
								if (
									validCompletion(context, event) &&
									!!completion(event).reply &&
									!!completion(event).result
								) {
									enq.sendTo('output', {
										type: 'REPORT' as const,
										event: {
											type: 'BACKGROUND_SAVED' as const,
											result: required(completion(event).result)
										}
									})
									enq.sendTo('resource', {
										type: 'POST' as const,
										message: {
											type: 'REPLY' as const,
											id: completion(event).id,
											reply: required(completion(event).reply)
										}
									})
									{
										if (!('actorId' in event)) throw new Error('Expected child completion')
										const task = context.tasks[event.actorId]
										if (task) enq.stop(task.ref)
										pendingContext = {
											...pendingContext,
											...(({ context }) => ({
												tasks: Object.fromEntries(
													Object.entries(context.tasks).filter(([id]) => id !== event.actorId)
												)
											}))({
												...args,
												context: { ...args.context, ...pendingContext },
												spawn: enq.spawn
											})
										}
									}
									return { context: pendingContext }
								}
								if (validCompletion(context, event) && !!completion(event).reply) {
									enq.sendTo('resource', {
										type: 'POST' as const,
										message: {
											type: 'REPLY' as const,
											id: completion(event).id,
											reply: required(completion(event).reply)
										}
									})
									{
										if (!('actorId' in event)) throw new Error('Expected child completion')
										const task = context.tasks[event.actorId]
										if (task) enq.stop(task.ref)
										pendingContext = {
											...pendingContext,
											...(({ context }) => ({
												tasks: Object.fromEntries(
													Object.entries(context.tasks).filter(([id]) => id !== event.actorId)
												)
											}))({
												...args,
												context: { ...args.context, ...pendingContext },
												spawn: enq.spawn
											})
										}
									}
									return { context: pendingContext }
								}
								if (
									validCompletion(context, event) &&
									!!completion(event).error &&
									!!task(context, event)?.retry
								) {
									enq.sendTo('output', {
										type: 'REPORT' as const,
										event: { type: 'BACKGROUND_ERROR' as const }
									})
									{
										if (!('actorId' in event)) throw new Error('Expected child completion')
										const task = context.tasks[event.actorId]
										if (task) enq.stop(task.ref)
										pendingContext = {
											...pendingContext,
											...(({ context }) => ({
												tasks: Object.fromEntries(
													Object.entries(context.tasks).filter(([id]) => id !== event.actorId)
												)
											}))({
												...args,
												context: { ...args.context, ...pendingContext },
												spawn: enq.spawn
											})
										}
									}
									return { context: pendingContext }
								}
								if (
									validCompletion(context, event) &&
									!!completion(event).error &&
									task(context, event)?.id === completion(event).id
								) {
									enq.sendTo('resource', {
										type: 'POST' as const,
										message: {
											type: 'ERROR' as const,
											id: completion(event).id,
											code: required(completion(event).error)
										}
									})
									{
										if (!('actorId' in event)) throw new Error('Expected child completion')
										const task = context.tasks[event.actorId]
										if (task) enq.stop(task.ref)
										pendingContext = {
											...pendingContext,
											...(({ context }) => ({
												tasks: Object.fromEntries(
													Object.entries(context.tasks).filter(([id]) => id !== event.actorId)
												)
											}))({
												...args,
												context: { ...args.context, ...pendingContext },
												spawn: enq.spawn
											})
										}
									}
									return { context: pendingContext }
								}
								{
									if (!('actorId' in event)) throw new Error('Expected child completion')
									const task = context.tasks[event.actorId]
									if (task) enq.stop(task.ref)
									pendingContext = {
										...pendingContext,
										...(({ context }) => ({
											tasks: Object.fromEntries(
												Object.entries(context.tasks).filter(([id]) => id !== event.actorId)
											)
										}))({
											...args,
											context: { ...args.context, ...pendingContext },
											spawn: enq.spawn
										})
									}
								}
								return { context: pendingContext }
							},
							CALL_ERROR: (args, enq) => {
								let pendingContext = {}

								const { context, event } = args
								if (cap.isCurrent() && !!task(context, event)?.retry) {
									enq.sendTo('output', {
										type: 'REPORT' as const,
										event: { type: 'BACKGROUND_ERROR' as const }
									})
									{
										if (!('actorId' in event)) throw new Error('Expected child completion')
										const task = context.tasks[event.actorId]
										if (task) enq.stop(task.ref)
										pendingContext = {
											...pendingContext,
											...(({ context }) => ({
												tasks: Object.fromEntries(
													Object.entries(context.tasks).filter(([id]) => id !== event.actorId)
												)
											}))({
												...args,
												context: { ...args.context, ...pendingContext },
												spawn: enq.spawn
											})
										}
									}
									return { context: pendingContext }
								}
								if (cap.isCurrent() && !!task(context, event)) {
									enq.sendTo('resource', {
										type: 'POST' as const,
										message: {
											type: 'ERROR' as const,
											id: required(task(context, event)).id,
											code: 'captureFailed'
										}
									})
									{
										if (!('actorId' in event)) throw new Error('Expected child completion')
										const task = context.tasks[event.actorId]
										if (task) enq.stop(task.ref)
										pendingContext = {
											...pendingContext,
											...(({ context }) => ({
												tasks: Object.fromEntries(
													Object.entries(context.tasks).filter(([id]) => id !== event.actorId)
												)
											}))({
												...args,
												context: { ...args.context, ...pendingContext },
												spawn: enq.spawn
											})
										}
									}
									return { context: pendingContext }
								}
								{
									if (!('actorId' in event)) throw new Error('Expected child completion')
									const task = context.tasks[event.actorId]
									if (task) enq.stop(task.ref)
									pendingContext = {
										...pendingContext,
										...(({ context }) => ({
											tasks: Object.fromEntries(
												Object.entries(context.tasks).filter(([id]) => id !== event.actorId)
											)
										}))({
											...args,
											context: { ...args.context, ...pendingContext },
											spawn: enq.spawn
										})
									}
								}
								return { context: pendingContext }
							}
						}
					},
					releasing: {
						entry: (args, enq) => {
							enq.sendTo('resource', { type: 'DISPOSE' as const })
						},
						on: {
							RESOURCE_CLOSED: { target: '#article-worker-host.closed' },
							RESOURCE_ERROR: (args, enq) => {
								enq.sendTo('output', {
									type: 'REPORT' as const,
									event: { type: 'BACKGROUND_ERROR' as const }
								})
							},
							STOP: {}
						}
					},

					draining: {
						entry: (args, enq) => {
							enq.sendTo('resource', { type: 'QUIESCE' as const })
							for (const task of Object.values(args.context.tasks))
								enq.sendTo(task.ref, { type: 'SHUTDOWN' as const })
						},
						always: (args) => {
							if (!(Object.keys(args.context.tasks).length === 0)) return
							return { target: 'releasing' }
						},
						on: {
							STOP: {},
							RESOURCE_ERROR: {},
							CALL_DONE: (args, enq) => {
								let pendingContext = {}

								const { context, event } = args
								{
									if (!('actorId' in event)) throw new Error('Expected child completion')
									const task = context.tasks[event.actorId]
									if (task) enq.stop(task.ref)
									pendingContext = {
										...pendingContext,
										...(({ context }) => ({
											tasks: Object.fromEntries(
												Object.entries(context.tasks).filter(([id]) => id !== event.actorId)
											)
										}))({
											...args,
											context: { ...args.context, ...pendingContext },
											spawn: enq.spawn
										})
									}
								}

								return { context: pendingContext }
							},
							CALL_ERROR: (args, enq) => {
								let pendingContext = {}

								const { context, event } = args
								{
									if (!('actorId' in event)) throw new Error('Expected child completion')
									const task = context.tasks[event.actorId]
									if (task) enq.stop(task.ref)
									pendingContext = {
										...pendingContext,
										...(({ context }) => ({
											tasks: Object.fromEntries(
												Object.entries(context.tasks).filter(([id]) => id !== event.actorId)
											)
										}))({
											...args,
											context: { ...args.context, ...pendingContext },
											spawn: enq.spawn
										})
									}
								}

								return { context: pendingContext }
							}
						}
					}
				}
			},
			closed: {
				type: 'final' as const,
				entry: (args, enq) => {
					enq.sendTo('output', {
						type: 'REPORT' as const,
						event: { type: 'BACKGROUND_CLOSED' as const }
					})
					return { context: { report: undefined, tasks: {} } }
				}
			}
		}
	})
}
