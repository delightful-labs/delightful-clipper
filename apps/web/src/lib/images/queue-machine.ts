import { t } from '../localization/index.js'
import { canRetryImageFetch, imageRetryDelay } from './failure.js'
import {
	assign,
	raise,
	enqueueActions,
	fromCallback,
	fromPromise,
	setup,
	stateIn,
	and,
	not,
	stopChild,
	sendTo
} from 'xstate'
import type { ActorRefFrom } from 'xstate'
import type { ImageCapability, ImageStageRef, ImageStageResult } from '../contracts/images.js'
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
	| { type: `xstate.done.actor.${string}`; actorId: string; output: ImageStageResult }
	| { type: `xstate.error.actor.${string}`; actorId: string; error: unknown }
type Context = Input & {
	worker: Worker | undefined
	observationFailed: boolean
	issue: unknown
	notBefore: number
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
	slots: ActorRefFrom<typeof imageViewMachine>[]
	views: Record<string, ImageView>
}
const observe = fromCallback<Event, ImageCapability>(({ input, sendBack }) =>
	input.subscribe(
		(rows) => sendBack({ type: 'IMAGE_ROWS', rows }),
		() => sendBack({ type: 'OBSERVATION_FAILED' })
	)
)
const connectivity = fromCallback<Event>(({ sendBack }) => {
	const report = () => sendBack({ type: 'CONNECTIVITY', online: navigator.onLine })
	window.addEventListener('online', report)
	window.addEventListener('offline', report)
	report()
	return () => {
		window.removeEventListener('online', report)
		window.removeEventListener('offline', report)
	}
})
const reconcile = fromPromise<boolean, Context>(({ input, signal }) =>
	input.capability!.hasIntent(input.selected!.id, signal)
)
const fetchImage = fromPromise<{ bytes: Uint8Array; mediaType: string }, Context>(
	({ input, signal }) =>
		input.capability!.request(input.selected!.sourceUrl, input.selected!.id, signal)
)
const process = fromCallback<Event>(({ sendBack }) => {
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
const post = fromCallback<Event, Context>(({ input, sendBack }) => {
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
const model = setup<
	Context,
	Event,
	{
		observe: typeof observe
		connectivity: typeof connectivity
		fetchImage: typeof fetchImage
		reconcile: typeof reconcile
		process: typeof process
		post: typeof post
		receipts: typeof syncOwnerMachine
		view: typeof imageViewMachine
	},
	{ receipts: 'receipts' },
	{
		attach: undefined
		detach: undefined
		startReady: undefined
		startFailure: undefined
		recordReady: undefined
		recordFailure: undefined
		selectNext: undefined
	},
	{
		current: undefined
		eligible: undefined
		closing: undefined
		ownCompletion: undefined
		workerSucceeded: undefined
		online: undefined
		retryableFetch: undefined
		currentView: undefined
		uncertainView: undefined
		readyView: undefined
		quotaCoolingDown: undefined
	},
	'retryDelay' | 'quotaDelay',
	string,
	Input
>({
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
					(0.8 + Math.random() * 0.4)
			),
		quotaDelay: ({ context }) => Math.max(0, context.notBefore - Date.now())
	},
	guards: {
		quotaCoolingDown: ({ context }) => context.notBefore > Date.now(),
		currentView: ({ context, event }) =>
			event.type === 'IMAGE_VIEW' &&
			context.capability?.isCurrent() === true &&
			event.documentId === context.documentId,
		uncertainView: ({ context, event }) =>
			event.type === 'IMAGE_VIEW' && !!event.view.id && context.uncertain.includes(event.view.id),
		readyView: ({ event }) => event.type === 'IMAGE_VIEW' && event.view.status === 'ready',
		retryableFetch: ({ context }) => canRetryImageFetch(context.issue),
		current: ({ context }) => context.capability?.isCurrent() === true,
		online: ({ context }) => context.online,
		eligible: ({ context }) => !!nextImage(context),
		closing: stateIn({ running: { control: 'closing' } }),
		ownCompletion: ({ context, event }) =>
			'actorId' in event && event.actorId === context.write?.id,
		workerSucceeded: ({ event }) =>
			event.type === 'WORKER_RESULT' && imageWorkerResultSchema.safeParse(event.value).success
	},
	actions: {
		selectNext: assign({
			selected: ({ context }) => nextImage(context),
			retryable: true,
			fetched: undefined,
			result: undefined
		}),
		startReady: assign(({ context, spawn }) => ({
			write: context.capability!.spawnReady(spawn, {
				image: context.selected!,
				kind: 'ready',
				result: context.result!
			})
		})),
		startFailure: assign(({ context, spawn }) => ({
			write: context.capability!.spawnFailure(spawn, {
				image: context.selected!,
				kind: 'failed',
				retryable: context.retryable
			})
		})),
		recordReady: assign(({ context }) => ({
			rows: context.rows.map((row) =>
				row.id === context.selected!.id
					? { ...row, status: 'ready' as const, assetId: row.id, retryable: false }
					: row
			),
			blocked: [...context.blocked, context.selected!.id],
			write: undefined,
			fetched: undefined,
			result: undefined
		})),
		recordFailure: assign(({ context }) => ({
			rows: context.rows.map((row) =>
				row.id === context.selected!.id
					? { ...row, status: 'failed' as const, assetId: null, retryable: context.retryable }
					: row
			),
			write: undefined,
			fetched: undefined,
			result: undefined
		})),
		detach: enqueueActions(({ context, enqueue }) => {
			for (const slot of context.slots) enqueue.stopChild(slot)
			enqueue.assign({ slots: [], views: {}, documentId: '' })
		}),
		attach: enqueueActions(({ context, event, enqueue }) => {
			if (event.type !== 'ATTACH') return
			for (const slot of context.slots) enqueue.stopChild(slot)
			const urls = imageSources(event.root.innerHTML)
			enqueue.assign(({ context, spawn }) => ({
				documentId: event.documentId,
				views: {},
				slots: urls.map((sourceUrl) =>
					spawn('view', {
						input: { capability: context.capability!, documentId: event.documentId, sourceUrl }
					})
				)
			}))
		})
	}
})
const writing = (start: 'startReady' | 'startFailure', settled: 'recordReady' | 'recordFailure') =>
	model.createStateConfig({
		entry: start,
		exit: stopChild(({ context }) => context.write!),
		on: {
			SHUTDOWN: {},
			OBSERVATION_FAILED: { actions: assign({ observationFailed: true }) },
			WAKE: {},
			'xstate.done.actor.*': [
				{
					guard: and([
						'ownCompletion',
						({ event }) => !event.output || event.output.settlement.kind === 'unresolved'
					]),
					target: 'uncertain'
				},
				{
					guard: and([
						'ownCompletion',
						({ event }) => event.output?.settlement.kind === 'locallyPersisted'
					]),
					target: 'routing',
					actions: [
						sendTo('receipts', ({ context, event }) => ({
							type: 'WATCH',
							id: context.selected!.id,
							receipts:
								event.output?.settlement.kind === 'locallyPersisted'
									? [event.output.settlement.workspace]
									: []
						})),
						settled
					]
				},
				{ guard: 'ownCompletion', target: 'blocked' }
			],
			'xstate.error.actor.*': { guard: 'ownCompletion', target: 'uncertain' }
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
		notBefore: 0,
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
		admitting: { always: [{ guard: 'current', target: 'running' }, { target: 'closed' }] },
		running: {
			type: 'parallel',
			invoke: [
				{
					src: 'observe',
					input: ({ context }) => context.capability!,
					onError: { actions: raise({ type: 'OBSERVATION_FAILED' }) }
				},
				{ src: 'connectivity' },
				{ id: 'receipts', src: 'receipts', input: ({ self }) => ({ reportTo: self }) }
			],
			always: {
				guard: and([
					'closing',
					not(stateIn({ running: { queue: 'savingReady' } })),
					not(stateIn({ running: { queue: 'savingFailure' } }))
				]),
				target: 'closed'
			},
			on: {
				IMAGE_ROWS: {
					guard: 'current',
					actions: [
						assign({ rows: ({ event }) => event.rows }),
						({ self }) => self.send({ type: 'WAKE' })
					]
				},
				CONNECTIVITY: {
					actions: [
						assign(({ context, event }) => ({
							online: event.online,
							attempts: event.online && !context.online ? {} : context.attempts
						})),
						({ self }) => self.send({ type: 'WAKE' })
					]
				},
				RETRY: {
					guard: ({ context, event }) =>
						context.capability?.isCurrent() === true &&
						(!context.blocked.includes(event.id) ||
							context.rows.some((row) => row.id === event.id && row.status === 'ready')),
					actions: [
						({ context, event }) => {
							for (const slot of context.slots) slot.send({ type: 'RETRY', id: event.id })
						},
						assign(({ context, event }) => ({
							attempts: { ...context.attempts, [event.id]: 0 },
							rows: context.rows.map((row) =>
								row.id === event.id && row.status !== 'ready'
									? { ...row, status: 'pending' as const, retryable: true }
									: row
							)
						})),
						({ self }) => self.send({ type: 'WAKE' })
					]
				},
				IMAGE_ERROR: {
					actions: ({ context, event }) => {
						for (const slot of context.slots) slot.send(event)
					}
				},
				ATTACH: { guard: 'current', actions: 'attach' },
				DETACH: { actions: 'detach' },
				IMAGE_VIEW: [
					{
						guard: and(['currentView', 'uncertainView', 'readyView']),
						actions: assign({
							views: ({ context, event }) => ({
								...context.views,
								[event.sourceUrl]: {
									...event.view,
									retry: false,
									message: { text: t('status.save_unknown'), variant: 'error' as const }
								}
							})
						})
					},
					{
						guard: and(['currentView', 'uncertainView']),
						actions: assign({
							views: ({ context, event }) => ({
								...context.views,
								[event.sourceUrl]: {
									...event.view,
									status: 'unknown' as const,
									retry: false,
									message: { text: t('status.save_unknown'), variant: 'error' as const }
								}
							})
						})
					},
					{
						guard: 'currentView',
						actions: assign({
							views: ({ context, event }) => ({ ...context.views, [event.sourceUrl]: event.view })
						})
					}
				]
			},
			states: {
				control: {
					initial: 'accepting',
					states: { accepting: { on: { SHUTDOWN: 'closing' } }, closing: {} }
				},
				queue: {
					initial: 'routing',
					on: {
						OBSERVATION_FAILED: {
							target: '.unavailable',
							actions: assign({ observationFailed: true })
						}
					},
					states: {
						routing: {
							always: [
								{ guard: ({ context }) => context.observationFailed, target: 'unavailable' },
								{
									guard: and(['current', 'online', 'eligible', not('closing'), 'quotaCoolingDown']),
									target: 'quotaBackoff'
								},
								{
									guard: and(['current', 'online', 'eligible', not('closing')]),
									target: 'selecting'
								},
								{ target: 'idle' }
							]
						},
						idle: { on: { WAKE: 'routing' } },
						selecting: {
							entry: 'selectNext',
							always: [
								{
									guard: ({ context }) => (context.attempts[context.selected!.id] ?? 0) > 0,
									target: 'backoff'
								},
								{ target: 'reconciling' }
							]
						},
						quotaBackoff: { after: { quotaDelay: 'quotaSelecting' }, on: { WAKE: 'routing' } },
						quotaSelecting: {
							entry: 'selectNext',
							always: [
								{
									guard: and(['current', 'online', 'eligible', not('closing')]),
									target: 'reconciling'
								},
								{ target: 'idle' }
							]
						},
						backoff: { after: { retryDelay: 'reconciling' }, on: { WAKE: 'routing' } },
						reconciling: {
							invoke: {
								src: 'reconcile',
								input: ({ context }) => context,
								onDone: [
									{ guard: not('current'), target: 'idle' },
									{ guard: not('online'), target: 'idle' },
									{ guard: ({ event }) => event.output, target: 'uncertain' },
									{ target: 'fetching' }
								],
								onError: 'uncertain'
							}
						},
						fetching: {
							entry: assign({
								attempts: ({ context }) => ({
									...context.attempts,
									[context.selected!.id]: (context.attempts[context.selected!.id] ?? 0) + 1
								})
							}),
							invoke: {
								src: 'fetchImage',
								input: ({ context }) => context,
								onDone: [
									{
										guard: 'current',
										target: 'processing',
										actions: assign({ fetched: ({ event }) => event.output })
									},
									{ target: 'idle' }
								],
								onError: {
									target: 'fetchFailed',
									actions: assign({
										issue: ({ event }) => event.error,
										notBefore: ({ event }) => Date.now() + imageRetryDelay(event.error)
									})
								}
							},
							after: { 25000: { target: 'savingFailure', actions: assign({ retryable: true }) } },
							on: { WAKE: { guard: not('online'), target: 'idle' } }
						},
						fetchFailed: {
							always: [
								{ guard: not('current'), target: 'idle' },
								{
									guard: 'retryableFetch',
									target: 'savingFailure',
									actions: assign({ retryable: true })
								},
								{ target: 'savingFailure', actions: assign({ retryable: false }) }
							]
						},
						processing: {
							initial: 'creating',
							states: {
								creating: {
									on: {
										WORKER_OPENED: {
											target: 'posting',
											actions: assign({ worker: ({ event }) => event.worker })
										}
									}
								},
								posting: {
									invoke: {
										src: 'post',
										input: ({ context }) => context,
										onError: {
											target: '#image-queue.running.queue.savingFailure',
											actions: assign({ retryable: false })
										}
									},
									on: { POSTED: { target: 'waiting', actions: assign({ fetched: undefined }) } }
								},
								waiting: {}
							},
							invoke: {
								src: 'process',
								onError: { target: 'savingFailure', actions: assign({ retryable: false }) }
							},
							on: {
								WORKER_RESULT: [
									{
										guard: not('current'),
										target: 'idle',
										actions: assign({ fetched: undefined, result: undefined })
									},
									{
										guard: 'workerSucceeded',
										target: 'savingReady',
										actions: assign({
											result: ({ event }) => imageWorkerResultSchema.parse(event.value).result
										})
									},
									{ target: 'savingFailure', actions: assign({ retryable: false }) }
								]
							},
							after: { 20000: { target: 'savingFailure', actions: assign({ retryable: false }) } }
						},
						savingReady: writing('startReady', 'recordReady'),
						savingFailure: writing('startFailure', 'recordFailure'),
						uncertain: {
							entry: [
								({ context }) => {
									for (const slot of context.slots)
										slot.send({ type: 'UNKNOWN', sourceUrl: context.selected!.sourceUrl })
								},
								assign({
									blocked: ({ context }) => [...context.blocked, context.selected!.id],
									uncertain: ({ context }) => [...context.uncertain, context.selected!.id],
									write: undefined,
									fetched: undefined,
									result: undefined
								})
							],
							always: 'routing'
						},
						blocked: {
							entry: assign({
								blocked: ({ context }) => [...context.blocked, context.selected!.id],
								uncertain: ({ context }) => [...context.uncertain, context.selected!.id],
								write: undefined,
								fetched: undefined,
								result: undefined
							}),
							always: 'routing'
						},
						unavailable: {}
					}
				}
			}
		},
		closed: {
			type: 'final',
			entry: [
				'detach',
				assign({
					rows: [],
					capability: undefined,
					selected: undefined,
					fetched: undefined,
					result: undefined,
					write: undefined
				})
			]
		}
	}
})
