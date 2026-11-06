import {
	assign,
	fromCallback,
	fromPromise,
	raise,
	sendTo,
	stopChild,
	setup,
	stateIn,
	and,
	not
} from 'xstate'
import type {
	ReaderCapability,
	ReaderStageRef,
	ReaderStageResult,
	ReadingViewport,
	ReadingFullscreen
} from '../../contracts/reader.js'
import type { ReaderChange, ReaderOperation, ReadingPosition } from '../../reader/schema.js'
import {
	canQueueReaderChange,
	mergeReadingProgress,
	projectReaderState,
	readerChangeKey
} from '../../reader/schema.js'
import {
	finalReadingPosition,
	viewportObservation,
	viewportRestoration
} from '../../reader/viewport-actors.js'
import { positionSchema } from '../../reader/schema.js'
import { sameReadingLocation } from '../../reader/anchors.js'
import { syncOwnerMachine } from '../storage/sync-owner.js'
import type { SyncReport } from '../../contracts/storage.js'
import { t } from '../../localization/index.js'
import { stateFeedback } from '../../contracts/feedback.js'
import type { SnapshotFrom } from 'xstate'

type Input = { capability: ReaderCapability | undefined }
type Attachment = { documentId: string; viewport: ReadingViewport }
type OwnedAttachment = Attachment & { id: string }
export type ReaderExperienceEvent =
	| { type: 'MEASURE'; position: ReadingPosition; attachmentId: string }
	| { type: 'INTERACT' | 'RESIZE' | 'RESTORED' | 'VIEWPORT_FAILED'; attachmentId: string }
	| { type: 'CHANGE'; change: ReaderChange }
	| { type: 'ROWS'; rows: ReaderOperation[] }
	| ({ type: 'ATTACH' } & Attachment)
	| {
			type:
				| 'REFLOW'
				| 'DETACH'
				| 'FOCUS'
				| 'SHOW_CONTROLS'
				| 'SHUTDOWN'
				| 'OBSERVATION_FAILED'
				| 'REFRESH_SYNC'
				| 'FULLSCREEN_EXITED'
	  }
	| SyncReport
	| { type: `xstate.done.actor.${string}`; actorId: string; output: ReaderStageResult }
	| { type: `xstate.error.actor.${string}`; actorId: string; error: unknown }
type Context = Input & {
	rows: ReaderOperation[]
	queue: ReaderChange[]
	drafts: ReaderChange[]
	write: ReaderStageRef | undefined
	operationId: string
	issued: ReaderChange | undefined
	attachment: OwnedAttachment | undefined
	currentPosition: ReadingPosition | undefined
	progress: Record<string, number>
	display: ReadingFullscreen | undefined
	sync: Record<string, 'pending' | 'accepted' | 'rejected'>
}
const observation = fromCallback<ReaderExperienceEvent, ReaderCapability | undefined>(
	({ input, sendBack }) =>
		input?.subscribe(
			(rows) => sendBack({ type: 'ROWS', rows }),
			() => sendBack({ type: 'OBSERVATION_FAILED' })
		)
)
const fullscreenEntry = fromPromise<void, ReadingFullscreen>(({ input }) => input.enter())
const fullscreenExit = fromPromise<void, ReadingFullscreen>(({ input }) => input.exit())
const fullscreenObservation = fromCallback<ReaderExperienceEvent, ReadingFullscreen | undefined>(
	({ input, sendBack }) => input?.observe(() => sendBack({ type: 'FULLSCREEN_EXITED' }))
)
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Reading resource unavailable')
	return value
}
function replaceDesired(queue: ReaderChange[], change: ReaderChange) {
	return [...queue.filter((item) => readerChangeKey(item) !== readerChangeKey(change)), change]
}
function remainingDrafts(drafts: ReaderChange[], rows: ReaderOperation[]) {
	const state = projectReaderState(rows)
	return drafts.filter(
		(change) =>
			JSON.stringify(
				change.field === 'position'
					? state.positions[change.documentId]
					: state.preferences[change.field]
			) !== JSON.stringify(change.value)
	)
}
const model = setup<
	Context,
	ReaderExperienceEvent,
	{
		observation: typeof observation
		viewportObservation: typeof viewportObservation
		viewportRestoration: typeof viewportRestoration
		receipts: typeof syncOwnerMachine
		fullscreenEntry: typeof fullscreenEntry
		fullscreenExit: typeof fullscreenExit
		fullscreenObservation: typeof fullscreenObservation
	},
	{},
	{ enqueue: undefined; dropIssuedDraft: undefined; updateRows: undefined },
	{
		current: undefined
		accepting: undefined
		validChange: undefined
		closing: undefined
		dataReady: undefined
		queued: undefined
		ownCompletion: undefined
		currentViewport: undefined
		validFinalPosition: undefined
	},
	never,
	string,
	Input
>({
	actors: {
		observation,
		viewportObservation,
		viewportRestoration,
		receipts: syncOwnerMachine,
		fullscreenEntry,
		fullscreenExit,
		fullscreenObservation
	},
	guards: {
		currentViewport: ({ context, event }) =>
			'attachmentId' in event && event.attachmentId === context.attachment?.id,
		validFinalPosition: ({ context }) => positionSchema.safeParse(context.currentPosition).success,
		current: ({ context }) => !!context.capability?.isCurrent(),
		accepting: stateIn({ active: { control: 'accepting' } }),
		closing: stateIn({ active: { control: 'closing' } }),
		dataReady: stateIn({ active: { data: { observing: 'ready' } } }),
		validChange: ({ context, event }) =>
			event.type === 'CHANGE' && canQueueReaderChange(context.queue, event.change),
		queued: ({ context }) => context.queue.length > 0,
		ownCompletion: ({ context, event }) => 'actorId' in event && event.actorId === context.write?.id
	},
	actions: {
		updateRows: assign(({ context, event }) =>
			event.type === 'ROWS'
				? {
						rows: event.rows,
						drafts: remainingDrafts(context.drafts, event.rows),
						progress: mergeReadingProgress(
							context.progress,
							projectReaderState(event.rows).progress
						)
					}
				: {}
		),
		enqueue: assign(({ context, event }) =>
			event.type === 'CHANGE'
				? {
						queue: replaceDesired(context.queue, event.change),
						drafts: replaceDesired(context.drafts, event.change)
					}
				: {}
		),
		dropIssuedDraft: assign(({ context }) => ({
			drafts: context.drafts.filter(
				(change) => JSON.stringify(change) !== JSON.stringify(context.issued)
			)
		}))
	}
})
export const readerExperienceMachine = model.createMachine({
	id: 'reader-experience',
	initial: 'admitting',
	context: ({ input }) => ({
		...input,
		rows: [],
		queue: [],
		drafts: [],
		write: undefined,
		operationId: '',
		issued: undefined,
		attachment: undefined,
		currentPosition: undefined,
		progress: {},
		display: undefined,
		sync: {}
	}),
	states: {
		admitting: { always: [{ guard: 'current', target: 'active' }, { target: 'closed' }] },
		active: {
			type: 'parallel',
			invoke: {
				id: 'receipts',
				src: 'receipts',
				input: ({ self }) => ({ reportTo: self }),
				onError: '#reader-experience.active.synchronization.failed'
			},
			always: {
				guard: and([
					'closing',
					not('queued'),
					not(stateIn({ active: { writer: 'writing' } })),
					stateIn({ active: { focus: 'normal' } }),
					stateIn({ active: { viewport: 'detached' } })
				]),
				target: 'closed'
			},
			on: {
				SYNC: {
					actions: [
						assign({
							sync: ({ context, event }) => ({ ...context.sync, [event.id]: event.status })
						}),
						raise({ type: 'REFRESH_SYNC' })
					]
				}
			},
			states: {
				control: {
					initial: 'accepting',
					states: { accepting: { on: { SHUTDOWN: 'closing' } }, closing: {} }
				},
				data: {
					initial: 'observing',
					states: {
						observing: {
							initial: 'loading',
							invoke: {
								src: 'observation',
								input: ({ context }) => context.capability,
								onError: 'failed'
							},
							on: {
								ROWS: { guard: 'current', actions: 'updateRows' },
								OBSERVATION_FAILED: 'failed',
								SHUTDOWN: 'closed'
							},
							states: {
								loading: {
									on: { ROWS: { guard: 'current', target: 'ready', actions: 'updateRows' } }
								},
								ready: {}
							}
						},
						failed: {
							meta: { name: t('reader.data_unavailable'), variant: 'error', priority: 4 },
							on: { SHUTDOWN: 'closed' }
						},
						closed: {}
					}
				},
				focus: {
					initial: 'normal',
					states: {
						normal: {
							entry: assign({ display: undefined }),
							on: {
								FOCUS: {
									guard: and(['accepting', 'current']),
									target: 'focused',
									actions: assign({
										display: ({ context }) => context.attachment?.viewport.fullscreen
									})
								}
							}
						},
						focused: {
							initial: 'admitting',
							invoke: { src: 'fullscreenObservation', input: ({ context }) => context.display },
							states: {
								admitting: {
									always: [
										{ guard: ({ context }) => context.display !== undefined, target: 'opening' },
										{ target: 'fallback' }
									]
								},
								opening: {
									initial: 'requested',
									invoke: {
										src: 'fullscreenEntry',
										input: ({ context }) => required(context.display),
										onDone: [
											{
												guard: stateIn({
													active: { focus: { focused: { opening: 'cancelling' } } }
												}),
												target: 'exiting'
											},
											{ target: 'fullscreen' }
										],
										onError: [
											{
												guard: stateIn({
													active: { focus: { focused: { opening: 'cancelling' } } }
												}),
												target: '#reader-experience.active.focus.normal'
											},
											{ target: 'fallback' }
										]
									},
									on: {
										SHOW_CONTROLS: '.cancelling',
										SHUTDOWN: '.cancelling',
										DETACH: '.cancelling',
										FULLSCREEN_EXITED: '.cancelling'
									},
									states: { requested: {}, cancelling: {} }
								},
								fullscreen: {
									on: {
										SHOW_CONTROLS: 'exiting',
										SHUTDOWN: 'exiting',
										DETACH: 'exiting',
										FULLSCREEN_EXITED: '#reader-experience.active.focus.normal'
									}
								},
								fallback: {
									on: {
										SHOW_CONTROLS: '#reader-experience.active.focus.normal',
										SHUTDOWN: '#reader-experience.active.focus.normal',
										DETACH: '#reader-experience.active.focus.normal'
									}
								},
								exiting: {
									invoke: {
										src: 'fullscreenExit',
										input: ({ context }) => required(context.display),
										onDone: '#reader-experience.active.focus.normal',
										onError: '#reader-experience.active.focus.normal'
									}
								}
							}
						}
					}
				},
				viewport: {
					initial: 'detached',
					states: {
						detached: {
							on: {
								ATTACH: {
									guard: and(['accepting', 'current']),
									target: 'attached',
									actions: assign({
										attachment: ({ event }) => ({
											documentId: event.documentId,
											viewport: event.viewport,
											id: crypto.randomUUID()
										}),
										currentPosition: undefined
									})
								}
							}
						},
						attached: {
							initial: 'waiting',
							invoke: {
								src: 'viewportObservation',
								input: ({ context }) => required(context.attachment)
							},
							on: {
								FOCUS: { guard: 'dataReady', target: '.restoring' },
								SHOW_CONTROLS: { guard: 'dataReady', target: '.restoring' },
								FULLSCREEN_EXITED: { guard: 'dataReady', target: '.restoring' },
								DETACH: { target: 'detached', actions: assign({ attachment: undefined }) },
								SHUTDOWN: { target: 'detached', actions: assign({ attachment: undefined }) },
								VIEWPORT_FAILED: { guard: 'currentViewport', target: 'failed' }
							},
							states: {
								waiting: {
									always: {
										guard: stateIn({ active: { data: { observing: 'ready' } } }),
										target: 'restoring',
										actions: assign({
											currentPosition: ({ context }) =>
												projectReaderState(context.rows).positions[
													required(context.attachment).documentId
												]
										})
									}
								},
								restoring: {
									invoke: {
										src: 'viewportRestoration',
										input: ({ context }) => ({
											...required(context.attachment),
											position: context.currentPosition
										})
									},
									on: {
										RESTORED: { guard: 'currentViewport', target: 'passive' },
										INTERACT: { guard: 'currentViewport', target: 'reading' },
										RESIZE: { guard: 'currentViewport', target: 'restoring', reenter: true },
										REFLOW: { target: 'restoring', reenter: true }
									}
								},
								passive: {
									on: {
										INTERACT: { guard: 'currentViewport', target: 'reading' },
										RESIZE: { guard: 'currentViewport', target: 'restoring' },
										REFLOW: 'restoring'
									}
								},
								reading: {
									on: {
										MEASURE: {
											guard: and([
												'currentViewport',
												({ context, event }) =>
													positionSchema.safeParse(event.position).success &&
													!sameReadingLocation(context.currentPosition, event.position)
											]),
											actions: [
												assign(({ context, event }) => ({
													currentPosition: event.position,
													progress: mergeReadingProgress(context.progress, {
														[required(context.attachment).documentId]: event.position.progress
													})
												})),
												raise(({ context, event }) => ({
													type: 'CHANGE',
													change: {
														field: 'position',
														documentId: required(context.attachment).documentId,
														value: {
															...event.position,
															progress: required(
																context.progress[required(context.attachment).documentId]
															)
														}
													}
												}))
											]
										},
										RESIZE: { guard: 'currentViewport', target: 'restoring' },
										REFLOW: 'restoring',
										DETACH: {
											target: '#reader-experience.active.viewport.detaching',
											actions: assign({
												currentPosition: ({ context }) =>
													finalReadingPosition(
														required(context.attachment).viewport,
														context.currentPosition
													)
											})
										},
										SHUTDOWN: {
											target: '#reader-experience.active.viewport.detaching',
											actions: assign({
												currentPosition: ({ context }) =>
													finalReadingPosition(
														required(context.attachment).viewport,
														context.currentPosition
													)
											})
										}
									}
								}
							}
						},
						detaching: {
							always: [
								{
									guard: and([
										'current',
										'validFinalPosition',
										not(stateIn({ active: { writer: 'uncertain' } }))
									]),
									target: 'detached',
									actions: assign(({ context }) => {
										const documentId = required(context.attachment).documentId
										const position = required(context.currentPosition)
										const progress = mergeReadingProgress(context.progress, {
											[documentId]: position.progress
										})
										const change: ReaderChange = {
											documentId,
											field: 'position',
											value: { ...position, progress: required(progress[documentId]) }
										}
										return {
											progress,
											queue: replaceDesired(context.queue, change),
											drafts: replaceDesired(context.drafts, change),
											attachment: undefined
										}
									})
								},
								{ target: 'detached', actions: assign({ attachment: undefined }) }
							]
						},
						failed: {
							meta: { name: t('reader.data_unavailable'), variant: 'error', priority: 4 },
							on: {
								DETACH: { target: 'detached', actions: assign({ attachment: undefined }) },
								SHUTDOWN: { target: 'detached', actions: assign({ attachment: undefined }) }
							}
						}
					}
				},
				synchronization: {
					initial: 'healthy',
					on: { REFRESH_SYNC: '.routing' },
					states: {
						routing: {
							always: [
								{
									guard: ({ context }) => Object.values(context.sync).includes('rejected'),
									target: 'failed'
								},
								{ target: 'healthy' }
							]
						},
						healthy: {},
						failed: {
							meta: {
								name: t('status.failed_subject', { subject: t('actions.sync') }),
								variant: 'error',
								priority: 1
							}
						}
					}
				},
				writer: {
					initial: 'idle',
					on: {
						CHANGE: {
							guard: and(['accepting', 'current', 'dataReady', 'validChange']),
							target: '.debouncing',
							actions: 'enqueue'
						},
						SHUTDOWN: '.routing'
					},
					states: {
						idle: { always: { guard: 'queued', target: 'routing' } },
						debouncing: {
							always: {
								guard: ({ context }) => context.queue.some((change) => change.field !== 'position'),
								target: 'routing'
							},
							after: { 1000: 'routing' },
							on: { DETACH: 'routing' }
						},
						routing: {
							always: [
								{
									guard: not('current'),
									target: 'idle',
									actions: assign({ queue: [], drafts: [] })
								},
								{ guard: and(['current', 'queued']), target: 'writing' },
								{ target: 'idle' }
							]
						},
						writing: {
							exit: stopChild(({ context }) => required(context.write)),
							entry: assign(({ context, spawn }) => {
								const issued = required(context.queue[0]),
									operationId = crypto.randomUUID()
								return {
									issued,
									operationId,
									queue: context.queue.slice(1),
									write: required(context.capability).spawnWrite(
										spawn,
										issued,
										operationId,
										context.rows
									)
								}
							}),
							on: {
								CHANGE: {
									guard: and(['accepting', 'current', 'dataReady', 'validChange']),
									actions: 'enqueue'
								},
								SHUTDOWN: {},
								'xstate.done.actor.*': [
									{
										guard: and([
											'ownCompletion',
											({ event }) => !event.output || event.output.settlement.kind === 'unresolved'
										]),
										target: 'uncertain',
										actions: assign({ queue: [], drafts: [], write: undefined })
									},
									{
										guard: and([
											'ownCompletion',
											({ event }) => event.output?.settlement.kind === 'locallyPersisted'
										]),
										target: 'routing',
										actions: [
											'dropIssuedDraft',
											sendTo('receipts', ({ context, event }) => ({
												type: 'WATCH',
												id: context.operationId,
												receipts:
													event.output?.settlement.kind === 'locallyPersisted'
														? [event.output.settlement.workspace]
														: []
											})),
											assign({
												sync: ({ context }) => ({
													...context.sync,
													[context.operationId]: 'pending'
												}),
												write: undefined
											})
										]
									},
									{
										guard: 'ownCompletion',
										target: 'failed',
										actions: ['dropIssuedDraft', assign({ write: undefined })]
									}
								],
								'xstate.error.actor.*': {
									guard: 'ownCompletion',
									target: 'uncertain',
									actions: assign({ queue: [], drafts: [], write: undefined })
								}
							}
						},
						failed: {
							meta: { name: t('reader.save_failed'), variant: 'error', priority: 2 },
							always: { guard: 'queued', target: 'routing' }
						},
						uncertain: {
							meta: { name: t('status.save_unknown'), variant: 'error', priority: 3 },
							on: { CHANGE: {}, ATTACH: 'idle', SHUTDOWN: {} }
						}
					}
				}
			}
		},
		closed: {
			type: 'final',
			entry: assign({
				rows: [],
				queue: [],
				drafts: [],
				attachment: undefined,
				write: undefined,
				capability: undefined,
				issued: undefined,
				currentPosition: undefined,
				progress: {},
				display: undefined,
				operationId: '',
				sync: {}
			})
		}
	}
})
export function selectReaderExperience(
	snapshot: SnapshotFrom<typeof readerExperienceMachine> | undefined
) {
	const current = snapshot?.context.capability?.isCurrent() === true
	const state = projectReaderState(current ? snapshot.context.rows : [])
	const preferences = { ...state.preferences }
	for (const change of current ? snapshot.context.drafts : [])
		if (change.field !== 'position') Object.assign(preferences, { [change.field]: change.value })
	return {
		...state,
		progress: current ? snapshot.context.progress : state.progress,
		preferences,
		focused: current && snapshot.matches({ active: { focus: 'focused' } }),
		ready: current && snapshot.matches({ active: { data: { observing: 'ready' } } }),
		enabled:
			!!snapshot?.context.capability?.isCurrent() &&
			snapshot.matches({ active: { control: 'accepting' } }) &&
			snapshot.matches({ active: { data: { observing: 'ready' } } }) &&
			!snapshot.matches({ active: { writer: 'uncertain' } }),
		message: stateFeedback(current ? Object.values(snapshot.getMeta()) : [])
	}
}
