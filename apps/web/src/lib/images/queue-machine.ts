import type { EventPayload } from '../machines/events.js'
import { types, createCallbackLogic, setup, createAsyncLogic, matchesState } from 'xstate'
import { connectivityEvents, isOnline } from '../offline/connectivity.js'
import { t } from '../localization/index.js'
import { canRetryImageFetch, imageRetryDelay } from './failure.js'

import type {
	ImageCapability,
	ImageSpawner,
	ImageStageRef,
	ImageStageResult
} from '../contracts/images.js'
import type { ReaderExperienceEvent } from '../machines/reader/experience.js'
import { imageViewMachine } from './view-machine.js'
import type { ImageView, ImageViewReport } from './view-machine.js'
import { canAcquireImage, imageWorkerResultSchema, imageSources } from './schema.js'
import type { ArticleImage, ProcessedImage } from './schema.js'
import { syncOwnerMachine } from '../machines/storage/sync-owner.js'
import type { SyncReport } from '../contracts/storage.js'
type Input = { capability: ImageCapability | undefined }
type Event =
	| ReaderExperienceEvent
	| ImageViewReport
	| SyncReport
	| { type: 'IMAGE_ROWS'; rows: ArticleImage[] }
	| { type: 'CONNECTIVITY'; online: boolean }
	| { type: 'WORKER_RESULT'; value: unknown }
	| { type: 'WORKER_OPENED'; worker: Worker }
	| { type: 'POSTED' }
	| { type: 'OBSERVATION_FAILED' }
	| { type: 'RETRY'; id: string }
	| { type: 'IMAGE_ERROR'; id: string; url: string }
	| { type: 'WAKE' }
	| { type: 'WRITE_DONE'; actorId: string; output: ImageStageResult }
	| { type: 'WRITE_ERROR'; actorId: string; error: unknown }
type Context = Input & {
	worker: Worker | undefined
	observationFailed: boolean
	issue: unknown
	quotaDelayMs: number
	rows: ArticleImage[]
	online: boolean
	attempts: Record<string, number>
	blocked: string[]
	uncertain: string[]
	selected: ArticleImage | undefined
	fetched: { bytes: Uint8Array; mediaType: string } | undefined
	result: ProcessedImage | undefined
	retryable: boolean
	write: ImageStageRef | undefined
	documentId: string
	slots: import('xstate').ActorFromLogic<typeof imageViewMachine>[]
	views: Record<string, ImageView>
}
// Stable per-operation jitter keeps predictive calculation free of entropy reads.
function retryJitter(id: string, attempt: number) {
	let hash = attempt
	for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619)
	return (hash >>> 0) / 4294967295
}
const observe = createCallbackLogic<Event, ImageCapability>(({ input, sendBack }) =>
	input.subscribe(
		(rows) => sendBack({ type: 'IMAGE_ROWS', rows }),
		() => sendBack({ type: 'OBSERVATION_FAILED' })
	)
)
const connectivity = createCallbackLogic<Event>(({ sendBack }) => {
	const report = () => sendBack({ type: 'CONNECTIVITY', online: isOnline() })
	connectivityEvents().addEventListener('online', report)
	connectivityEvents().addEventListener('offline', report)
	report()
	return () => {
		connectivityEvents().removeEventListener('online', report)
		connectivityEvents().removeEventListener('offline', report)
	}
})
const reconcile = createAsyncLogic<boolean, Context>({
	run: ({ input, signal }) => input.capability!.hasIntent(input.selected!.id, signal)
})
const fetchImage = createAsyncLogic<{ bytes: Uint8Array; mediaType: string }, Context>({
	run: ({ input, signal }) =>
		input.capability!.request(input.selected!.sourceUrl, input.selected!.id, signal)
})
const process = createCallbackLogic<Event>(({ sendBack }) => {
	const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
	worker.onmessage = (event) => sendBack({ type: 'WORKER_RESULT', value: event.data })
	worker.onerror = () => sendBack({ type: 'WORKER_RESULT', value: undefined })
	sendBack({ type: 'WORKER_OPENED', worker })
	return () => {
		worker.onmessage = null
		worker.onerror = null
		worker.terminate()
	}
})
const post = createCallbackLogic<Event, Context>(({ input, sendBack }) => {
	input.worker!.postMessage(input.fetched)
	sendBack({ type: 'POSTED' })
})
function nextImage(context: Context) {
	const eligible = context.rows.filter(
		(row) =>
			!context.blocked.includes(row.id) &&
			(context.attempts[row.id] ?? 0) < 5 &&
			canAcquireImage(row)
	)
	return eligible.find((row) => row.status === 'pending') ?? eligible[0]
}
const model = setup({
	schemas: {
		context: types<Context>(),
		events: {
			WRITE_DONE: types<{ actorId: string; output: ImageStageResult }>(),
			WRITE_ERROR: types<{ actorId: string; error: unknown }>(),
			SYNC: types<EventPayload<Event, 'SYNC'>>(),
			MEASURE: types<EventPayload<Event, 'MEASURE'>>(),
			VIEWPORT_FAILED: types<EventPayload<Event, 'VIEWPORT_FAILED'>>(),
			CHANGE: types<EventPayload<Event, 'CHANGE'>>(),
			ROWS: types<EventPayload<Event, 'ROWS'>>(),
			ATTACH: types<EventPayload<Event, 'ATTACH'>>(),
			ATTACH_SURFACE: types<EventPayload<Event, 'ATTACH_SURFACE'>>(),
			SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
			REFLOW: types<EventPayload<Event, 'REFLOW'>>(),
			DETACH: types<EventPayload<Event, 'DETACH'>>(),
			FOCUS: types<EventPayload<Event, 'FOCUS'>>(),
			SHOW_CONTROLS: types<EventPayload<Event, 'SHOW_CONTROLS'>>(),
			OBSERVATION_FAILED: types<EventPayload<Event, 'OBSERVATION_FAILED'>>(),
			REFRESH_SYNC: types<EventPayload<Event, 'REFRESH_SYNC'>>(),
			FULLSCREEN_CHANGED: types<EventPayload<Event, 'FULLSCREEN_CHANGED'>>(),
			FULLSCREEN_OBSERVED: types<EventPayload<Event, 'FULLSCREEN_OBSERVED'>>(),
			IMAGE_VIEW: types<EventPayload<Event, 'IMAGE_VIEW'>>(),
			IMAGE_ROWS: types<EventPayload<Event, 'IMAGE_ROWS'>>(),
			CONNECTIVITY: types<EventPayload<Event, 'CONNECTIVITY'>>(),
			WORKER_RESULT: types<EventPayload<Event, 'WORKER_RESULT'>>(),
			WORKER_OPENED: types<EventPayload<Event, 'WORKER_OPENED'>>(),
			POSTED: types<EventPayload<Event, 'POSTED'>>(),
			RETRY: types<EventPayload<Event, 'RETRY'>>(),
			IMAGE_ERROR: types<EventPayload<Event, 'IMAGE_ERROR'>>(),
			WAKE: types<EventPayload<Event, 'WAKE'>>()
		},
		input: types<Input>(),
		tags: types<string>(),
		children: {
			observe: types<import('xstate').ActorRefFrom<typeof observe>>(),
			connectivity: types<import('xstate').ActorRefFrom<typeof connectivity>>(),
			fetchImage: types<import('xstate').ActorRefFrom<typeof fetchImage>>(),
			reconcile: types<import('xstate').ActorRefFrom<typeof reconcile>>(),
			process: types<import('xstate').ActorRefFrom<typeof process>>(),
			post: types<import('xstate').ActorRefFrom<typeof post>>(),
			receipts: types<import('xstate').ActorRefFrom<typeof syncOwnerMachine>>(),
			view: types<import('xstate').ActorRefFrom<typeof imageViewMachine>>()
		}
	},
	actors: {
		observe,
		connectivity,
		fetchImage,
		reconcile,
		process,
		post,
		receipts: syncOwnerMachine,
		view: imageViewMachine
	},
	delays: {
		retryDelay: ({ context }) =>
			Math.min(
				300000,
				1000 *
					2 ** Math.max(0, (context.attempts[context.selected!.id] ?? 1) - 1) *
					(0.8 +
						retryJitter(context.selected!.id, context.attempts[context.selected!.id] ?? 1) * 0.4)
			),
		quotaDelay: ({ context }) => context.quotaDelayMs
	},
	guards: {
		quotaCoolingDown: ({ context }: { context: Context }) => context.quotaDelayMs > 0,
		currentView: ({ context, event }: { context: Context; event: Event }) =>
			event.type === 'IMAGE_VIEW' &&
			context.capability?.isCurrent() === true &&
			event.documentId === context.documentId,
		uncertainView: ({ context, event }: { context: Context; event: Event }) =>
			event.type === 'IMAGE_VIEW' && !!event.view.id && context.uncertain.includes(event.view.id),
		readyView: ({ event }: { event: Event }) =>
			event.type === 'IMAGE_VIEW' && event.view.status === 'ready',
		retryableFetch: ({ context }: { context: Context }) => canRetryImageFetch(context.issue),
		current: ({ context }: { context: Context }) => context.capability?.isCurrent() === true,
		online: ({ context }: { context: Context }) => context.online,
		eligible: ({ context }: { context: Context }) => !!nextImage(context),
		closing: ({ value }: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'closing' } }, value),
		ownCompletion: ({ context, event }: { context: Context; event: Event }) =>
			'actorId' in event && event.actorId === context.write?.id,
		workerSucceeded: ({ event }: { event: Event }) =>
			event.type === 'WORKER_RESULT' && imageWorkerResultSchema.safeParse(event.value).success
	},
	actions: {
		selectNext: ({ context }: { context: Context }) => ({
			context: {
				selected: nextImage(context),
				retryable: true,
				fetched: undefined,
				result: undefined
			}
		}),
		startReady: ({ context, spawn }: { context: Context; spawn: ImageSpawner }) => ({
			context: {
				write: context.capability!.spawnReady(spawn, {
					image: context.selected!,
					kind: 'ready',
					result: context.result!
				})
			}
		}),
		startFailure: ({ context, spawn }: { context: Context; spawn: ImageSpawner }) => ({
			context: {
				write: context.capability!.spawnFailure(spawn, {
					image: context.selected!,
					kind: 'failed',
					retryable: context.retryable
				})
			}
		}),
		recordReady: ({ context }: { context: Context }): { context: Partial<Context> } => ({
			context: {
				rows: context.rows.map((row) =>
					row.id === context.selected!.id
						? { ...row, status: 'ready', assetId: row.id, retryable: false }
						: row
				),
				blocked: [...context.blocked, context.selected!.id],
				write: undefined,
				fetched: undefined,
				result: undefined
			}
		}),
		recordFailure: ({ context }: { context: Context }): { context: Partial<Context> } => ({
			context: {
				rows: context.rows.map((row) =>
					row.id === context.selected!.id
						? { ...row, status: 'failed', assetId: null, retryable: context.retryable }
						: row
				),
				write: undefined,
				fetched: undefined,
				result: undefined
			}
		}),
		notifyUncertain: ({ context }: { context: Context }) => {
			for (const slot of context.slots)
				slot.send({ type: 'UNKNOWN', sourceUrl: context.selected!.sourceUrl })
		},
		recordUncertain: ({ context }: { context: Context }): { context: Partial<Context> } => ({
			context: {
				blocked: [...context.blocked, context.selected!.id],
				uncertain: [...context.uncertain, context.selected!.id],
				write: undefined,
				fetched: undefined,
				result: undefined
			}
		})
	}
})

export const imageQueueMachine = model.createMachine({
	id: 'image-queue',
	initial: 'admitting',
	context: ({ input }) => ({
		...input,
		worker: undefined,
		observationFailed: false,
		issue: undefined,
		quotaDelayMs: 0,
		rows: [],
		online: false,
		attempts: {},
		blocked: [],
		uncertain: [],
		selected: undefined,
		fetched: undefined,
		result: undefined,
		retryable: true,
		write: undefined,
		documentId: '',
		slots: [],
		views: {}
	}),
	states: {
		admitting: {
			type: 'choice',
			choice: (args) => {
				if (args.guards.current(args)) {
					return { target: 'running' }
				}
				return { target: 'closed' }
			}
		},
		running: {
			type: 'parallel',
			invoke: [
				{
					id: 'observe',
					src: 'observe',
					input: ({ context }: { context: Context }) => context.capability!,
					onError: (args, enq) => {
						enq.raise({ type: 'OBSERVATION_FAILED' })
					}
				},
				{ id: 'connectivity', src: 'connectivity' },
				{ id: 'receipts', src: 'receipts', input: ({ self }) => ({ reportTo: self }) }
			],
			always: (args) => {
				if (
					!(
						args.guards.closing(args) &&
						!(({ value }: { value: import('xstate').StateValue }) =>
							matchesState({ running: { queue: 'savingReady' } }, value))(args) &&
						!(({ value }: { value: import('xstate').StateValue }) =>
							matchesState({ running: { queue: 'savingFailure' } }, value))(args)
					)
				)
					return
				return { target: 'closed' }
			},
			on: {
				IMAGE_ROWS: (args, enq) => {
					if (!args.guards.current(args)) return
					enq(() => args.self.send({ type: 'WAKE' }))
					return { context: { rows: args.event.rows } }
				},
				CONNECTIVITY: (args, enq) => {
					const { context, event } = args
					enq(() => args.self.send({ type: 'WAKE' }))
					return {
						context: {
							online: event.online,
							attempts: event.online && !context.online ? {} : context.attempts
						}
					}
				},
				RETRY: (args, enq) => {
					const { context, event } = args
					if (
						!(
							context.capability?.isCurrent() === true &&
							(!context.blocked.includes(event.id) ||
								context.rows.some((row) => row.id === event.id && row.status === 'ready'))
						)
					)
						return
					enq(({ context, event }) => {
						for (const slot of context.slots) slot.send({ type: 'RETRY', id: event.id })
					}, args)
					enq(() => args.self.send({ type: 'WAKE' }))
					return {
						context: {
							attempts: { ...context.attempts, [event.id]: 0 },
							rows: context.rows.map((row) =>
								row.id === event.id && row.status !== 'ready'
									? { ...row, status: 'pending', retryable: true }
									: row
							)
						}
					}
				},
				IMAGE_ERROR: (args, enq) => {
					enq(({ context, event }) => {
						for (const slot of context.slots) slot.send(event)
					}, args)
				},
				ATTACH: (args, enq) => {
					if (!args.guards.current(args)) return
					const { context, event } = args
					for (const slot of context.slots) enq.stop(slot)
					const urls = imageSources(event.root.innerHTML)
					return {
						context: {
							documentId: event.documentId,
							views: {},
							slots: urls.map((sourceUrl) =>
								enq.spawn('view', {
									input: {
										capability: context.capability!,
										documentId: event.documentId,
										sourceUrl
									}
								})
							)
						}
					}
				},
				ATTACH_SURFACE: (args, enq) => {
					if (!args.guards.current(args)) return
					const { context, event } = args
					for (const slot of context.slots) enq.stop(slot)
					const urls = event.sources
					return {
						context: {
							documentId: event.documentId,
							views: {},
							slots: urls.map((sourceUrl) =>
								enq.spawn('view', {
									input: {
										capability: context.capability!,
										documentId: event.documentId,
										sourceUrl
									}
								})
							)
						}
					}
				},
				DETACH: ({ context }, enq) => {
					for (const slot of context.slots) enq.stop(slot)
					return { context: { slots: [], views: {}, documentId: '' } }
				},
				IMAGE_VIEW: (args) => {
					const { context, event } = args
					if (
						args.guards.currentView(args) &&
						args.guards.uncertainView(args) &&
						args.guards.readyView(args)
					) {
						return {
							context: {
								views: {
									...context.views,
									[event.sourceUrl]: {
										...event.view,
										retry: false,
										message: { text: t('status.save_unknown'), variant: 'error' }
									}
								}
							}
						}
					}
					if (args.guards.currentView(args) && args.guards.uncertainView(args)) {
						return {
							context: {
								views: {
									...context.views,
									[event.sourceUrl]: {
										...event.view,
										status: 'unknown',
										retry: false,
										message: { text: t('status.save_unknown'), variant: 'error' }
									}
								}
							}
						}
					}
					if (args.guards.currentView(args)) {
						return { context: { views: { ...context.views, [event.sourceUrl]: event.view } } }
					}
				}
			},
			states: {
				control: {
					initial: 'accepting',
					states: { accepting: { on: { SHUTDOWN: { target: 'closing' } } }, closing: {} }
				},
				queue: {
					initial: 'routing',
					on: {
						OBSERVATION_FAILED: () => {
							return { target: '.unavailable', context: { observationFailed: true } }
						}
					},
					states: {
						routing: {
							type: 'choice',
							choice: (args) => {
								if (args.context.observationFailed) {
									return { target: 'unavailable' }
								}
								if (
									args.guards.current(args) &&
									args.guards.online(args) &&
									args.guards.eligible(args) &&
									!args.guards.closing(args) &&
									args.guards.quotaCoolingDown(args)
								) {
									return { target: 'quotaBackoff' }
								}
								if (
									args.guards.current(args) &&
									args.guards.online(args) &&
									args.guards.eligible(args) &&
									!args.guards.closing(args)
								) {
									return { target: 'selecting' }
								}
								return { target: 'idle' }
							}
						},
						idle: { on: { WAKE: { target: 'routing' } } },
						selecting: {
							entry: (args) => {
								return { context: args.actions.selectNext(args).context }
							},
							always: (args) => {
								const { context } = args
								if ((context.attempts[context.selected!.id] ?? 0) > 0) {
									return { target: 'backoff' }
								}
								return { target: 'reconciling' }
							}
						},
						quotaBackoff: {
							after: { quotaDelay: { target: 'quotaSelecting', context: { quotaDelayMs: 0 } } },
							on: { WAKE: {} }
						},
						quotaSelecting: {
							entry: (args) => {
								return { context: args.actions.selectNext(args).context }
							},
							always: (args) => {
								if (
									args.guards.current(args) &&
									args.guards.online(args) &&
									args.guards.eligible(args) &&
									!args.guards.closing(args)
								) {
									return { target: 'reconciling' }
								}
								return { target: 'idle' }
							}
						},
						backoff: {
							after: { retryDelay: { target: 'reconciling' } },
							on: { WAKE: { target: 'routing' } }
						},
						reconciling: {
							invoke: {
								id: 'reconcile',
								src: 'reconcile',
								input: ({ context }: { context: Context }) => context,
								onDone: (args, enq) => {
									if (!args.guards.current(args)) {
										return { target: 'idle' }
									}
									if (!args.guards.online(args)) {
										return { target: 'idle' }
									}
									if (args.event.output) {
										enq(args.actions.notifyUncertain, args)
										return {
											target: 'routing',
											context: args.actions.recordUncertain(args).context
										}
									}
									return { target: 'fetching' }
								},
								onError: (args, enq) => {
									enq(args.actions.notifyUncertain, args)
									return { target: 'routing', context: args.actions.recordUncertain(args).context }
								}
							}
						},
						fetching: {
							entry: (args) => {
								const { context } = args
								return {
									context: {
										attempts: {
											...context.attempts,
											[context.selected!.id]: (context.attempts[context.selected!.id] ?? 0) + 1
										}
									}
								}
							},
							invoke: {
								id: 'fetchImage',
								src: 'fetchImage',
								input: ({ context }: { context: Context }) => context,
								onDone: (args) => {
									if (args.guards.current(args)) {
										return { target: 'processing', context: { fetched: args.event.output } }
									}
									return { target: 'idle' }
								},
								onError: (args) => {
									const { event } = args
									return {
										target: 'fetchFailed',
										context: {
											issue: event.error,
											quotaDelayMs: imageRetryDelay(event.error)
										}
									}
								}
							},
							after: {
								25000: () => {
									return { target: 'savingFailure', context: { retryable: true } }
								}
							},
							on: {
								WAKE: (args) => {
									if (args.guards.online(args)) return
									return { target: 'idle' }
								}
							}
						},
						fetchFailed: {
							always: (args) => {
								if (!args.guards.current(args)) {
									return { target: 'idle' }
								}
								if (args.guards.retryableFetch(args)) {
									return { target: 'savingFailure', context: { retryable: true } }
								}
								return { target: 'savingFailure', context: { retryable: false } }
							}
						},
						processing: {
							initial: 'creating',
							states: {
								creating: {
									on: {
										WORKER_OPENED: (args) => {
											return { target: 'posting', context: { worker: args.event.worker } }
										}
									}
								},
								posting: {
									invoke: {
										id: 'post',
										src: 'post',
										input: ({ context }: { context: Context }) => context,
										onError: () => {
											return {
												target: '#image-queue.running.queue.savingFailure',
												context: { retryable: false }
											}
										}
									},
									on: {
										POSTED: () => {
											return { target: 'waiting', context: { fetched: undefined } }
										}
									}
								},
								waiting: {}
							},
							invoke: {
								id: 'process',
								src: 'process',
								onError: () => {
									return { target: 'savingFailure', context: { retryable: false } }
								}
							},
							on: {
								WORKER_RESULT: (args) => {
									if (!args.guards.current(args)) {
										return { target: 'idle', context: { fetched: undefined, result: undefined } }
									}
									if (args.guards.workerSucceeded(args)) {
										return {
											target: 'savingReady',
											context: { result: imageWorkerResultSchema.parse(args.event.value).result }
										}
									}
									return { target: 'savingFailure', context: { retryable: false } }
								}
							},
							after: {
								20000: () => {
									return { target: 'savingFailure', context: { retryable: false } }
								}
							}
						},
						savingReady: {
							entry: (args, enq) => {
								const result = args.actions['startReady']({ ...args, spawn: enq.spawn })
								const ref = result.context.write
								enq.subscribeTo(ref, {
									done: (output): Extract<Event, { type: 'WRITE_DONE' | 'WRITE_ERROR' }> => ({
										type: 'WRITE_DONE',
										actorId: ref.id,
										output
									}),
									error: (error): Extract<Event, { type: 'WRITE_DONE' | 'WRITE_ERROR' }> => ({
										type: 'WRITE_ERROR',
										actorId: ref.id,
										error
									})
								})
								return result
							},
							exit: (args, enq) => {
								enq.stop(args.context.write!)
							},
							on: {
								SHUTDOWN: {},
								OBSERVATION_FAILED: () => {
									return { context: { observationFailed: true } }
								},
								WAKE: {},
								WRITE_DONE: (args, enq) => {
									if (!args.guards.ownCompletion(args)) return
									const { context, event } = args
									if (!event.output || event.output.settlement.kind === 'unresolved') {
										enq(args.actions.notifyUncertain, args)
										return {
											target: 'routing',
											context: args.actions.recordUncertain(args).context
										}
									}
									if (event.output.settlement.kind === 'locallyPersisted') {
										enq.sendTo('receipts', {
											type: 'WATCH',
											id: context.selected!.id,
											receipts: [event.output.settlement.workspace]
										})
										return { target: 'routing', context: args.actions['recordReady'](args).context }
									}
									return { target: 'routing', context: args.actions.recordUncertain(args).context }
								},
								WRITE_ERROR: (args, enq) => {
									if (!args.guards.ownCompletion(args)) return
									enq(args.actions.notifyUncertain, args)
									return { target: 'routing', context: args.actions.recordUncertain(args).context }
								}
							}
						},
						savingFailure: {
							entry: (args, enq) => {
								const result = args.actions['startFailure']({ ...args, spawn: enq.spawn })
								const ref = result.context.write
								enq.subscribeTo(ref, {
									done: (output): Extract<Event, { type: 'WRITE_DONE' | 'WRITE_ERROR' }> => ({
										type: 'WRITE_DONE',
										actorId: ref.id,
										output
									}),
									error: (error): Extract<Event, { type: 'WRITE_DONE' | 'WRITE_ERROR' }> => ({
										type: 'WRITE_ERROR',
										actorId: ref.id,
										error
									})
								})
								return result
							},
							exit: (args, enq) => {
								enq.stop(args.context.write!)
							},
							on: {
								SHUTDOWN: {},
								OBSERVATION_FAILED: () => {
									return { context: { observationFailed: true } }
								},
								WAKE: {},
								WRITE_DONE: (args, enq) => {
									if (!args.guards.ownCompletion(args)) return
									const { context, event } = args
									if (!event.output || event.output.settlement.kind === 'unresolved') {
										enq(args.actions.notifyUncertain, args)
										return {
											target: 'routing',
											context: args.actions.recordUncertain(args).context
										}
									}
									if (event.output.settlement.kind === 'locallyPersisted') {
										enq.sendTo('receipts', {
											type: 'WATCH',
											id: context.selected!.id,
											receipts: [event.output.settlement.workspace]
										})
										return {
											target: 'routing',
											context: args.actions['recordFailure'](args).context
										}
									}
									return { target: 'routing', context: args.actions.recordUncertain(args).context }
								},
								WRITE_ERROR: (args, enq) => {
									if (!args.guards.ownCompletion(args)) return
									enq(args.actions.notifyUncertain, args)
									return { target: 'routing', context: args.actions.recordUncertain(args).context }
								}
							}
						},
						unavailable: {}
					}
				}
			}
		},
		closed: {
			type: 'final',
			entry: ({ context }, enq) => {
				for (const slot of context.slots) enq.stop(slot)
				return {
					context: {
						slots: [],
						views: {},
						documentId: '',
						rows: [],
						capability: undefined,
						selected: undefined,
						fetched: undefined,
						result: undefined,
						write: undefined
					}
				}
			}
		}
	}
})
