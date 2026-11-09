import { identityLogic } from '../identity.js'
import type { EventPayload } from '../events.js'
import {
	types,
	createCallbackLogic,
	setup,
	createAsyncLogic,
	matchesState,
	type SnapshotFrom
} from 'xstate'

import type { ReaderCapability, ReaderStageRef, ReaderStageResult } from '../../contracts/reader.js'
import type { ReaderChange, ReaderOperation, ReadingPosition } from '../../reader/schema.js'
import {
	canQueueReaderChange,
	mergeReadingProgress,
	projectReaderState,
	readerChangeKey
} from '../../reader/schema.js'
import { positionSchema } from '../../reader/schema.js'
import type { ViewportElements } from '../../reader/viewport.js'
import { surfaceViewportMachine as viewportMachine } from '../../reader/surface-viewport.js'
import type { ReaderSurface, FullscreenSurface } from '../../reader/surface.js'
import { nativeReaderSurface } from '../../reader/native-surface.js'

import { syncOwnerMachine } from '../storage/sync-owner.js'
import type { SyncReport } from '../../contracts/storage.js'
import { t } from '../../localization/index.js'
import { stateFeedback } from '../../contracts/feedback.js'

type Input = { capability: ReaderCapability | undefined }
type Attachment = { documentId: string; surface: ReaderSurface }
type OwnedAttachment = Attachment & { id: string }
export type ReaderExperienceEvent =
	| { type: 'MEASURE'; position: ReadingPosition; attachmentId: string }
	| { type: 'VIEWPORT_FAILED'; attachmentId: string }
	| { type: 'CHANGE'; change: ReaderChange }
	| { type: 'ROWS'; rows: ReaderOperation[] }
	| ({ type: 'ATTACH' } & ViewportElements & { documentId: string })
	| ({ type: 'ATTACH_SURFACE'; sources: string[] } & Attachment)
	| {
			type:
				| 'REFLOW'
				| 'DETACH'
				| 'FOCUS'
				| 'SHOW_CONTROLS'
				| 'SHUTDOWN'
				| 'OBSERVATION_FAILED'
				| 'REFRESH_SYNC'
				| 'FULLSCREEN_CHANGED'
				| 'FULLSCREEN_OBSERVED'
	  }
	| SyncReport
type ReaderLifecycle =
	| { type: 'READER_WRITE_DONE'; actorId: string; output: ReaderStageResult }
	| { type: 'READER_WRITE_ERROR'; actorId: string; error: unknown }
type Event = ReaderExperienceEvent | ReaderLifecycle
type Context = Input & {
	rows: ReaderOperation[]
	queue: ReaderChange[]
	drafts: ReaderChange[]
	write: ReaderStageRef | undefined
	operationId: string
	issued: ReaderChange | undefined
	attachment: OwnedAttachment | undefined
	pendingAttachment: Attachment | undefined
	progress: Record<string, number>
	display: FullscreenSurface | undefined
	sync: Record<string, 'pending' | 'accepted' | 'rejected'>
}
// Keep attachment admission synchronous so native fullscreen retains user activation.
const attachmentIdentity = createCallbackLogic<never>(({ sendBack }) => {
	sendBack({ type: 'ATTACHMENT_IDENTIFIED', id: crypto.randomUUID() })
})
const observation = createCallbackLogic<ReaderExperienceEvent, ReaderCapability | undefined>(
	({ input, sendBack }) =>
		input?.subscribe(
			(rows) => sendBack({ type: 'ROWS' as const, rows }),
			() => sendBack({ type: 'OBSERVATION_FAILED' as const })
		)
)
const fullscreenEntry = createAsyncLogic<void, FullscreenSurface>({
	run: ({ input }) => input.enter()
})
const fullscreenExit = createAsyncLogic<void, FullscreenSurface>({
	run: ({ input }) => input.exit()
})
const fullscreenObservation = createCallbackLogic<ReaderExperienceEvent, FullscreenSurface>(
	({ input, sendBack }) => {
		const change = () => sendBack({ type: 'FULLSCREEN_CHANGED' as const })
		const release = input.observe(change)
		sendBack({ type: 'FULLSCREEN_OBSERVED' as const })
		return release
	}
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
const model = setup({
	schemas: {
		meta: types<{
			name?: string
			variant?: 'info' | 'error'
			channel?: string
			priority?: number
		}>(),
		context: types<Context>(),
		events: {
			ATTACHMENT_IDENTIFIED: types<{ id: string }>(),
			READER_WRITE_DONE: types<{ actorId: string; output: ReaderStageResult }>(),
			READER_WRITE_ERROR: types<{ actorId: string; error: unknown }>(),
			SYNC: types<EventPayload<ReaderExperienceEvent, 'SYNC'>>(),
			MEASURE: types<EventPayload<ReaderExperienceEvent, 'MEASURE'>>(),
			VIEWPORT_FAILED: types<EventPayload<ReaderExperienceEvent, 'VIEWPORT_FAILED'>>(),
			CHANGE: types<EventPayload<ReaderExperienceEvent, 'CHANGE'>>(),
			ROWS: types<EventPayload<ReaderExperienceEvent, 'ROWS'>>(),
			ATTACH: types<EventPayload<ReaderExperienceEvent, 'ATTACH'>>(),
			ATTACH_SURFACE: types<EventPayload<ReaderExperienceEvent, 'ATTACH_SURFACE'>>(),
			SHUTDOWN: types<EventPayload<ReaderExperienceEvent, 'SHUTDOWN'>>(),
			REFLOW: types<EventPayload<ReaderExperienceEvent, 'REFLOW'>>(),
			DETACH: types<EventPayload<ReaderExperienceEvent, 'DETACH'>>(),
			FOCUS: types<EventPayload<ReaderExperienceEvent, 'FOCUS'>>(),
			SHOW_CONTROLS: types<EventPayload<ReaderExperienceEvent, 'SHOW_CONTROLS'>>(),
			OBSERVATION_FAILED: types<EventPayload<ReaderExperienceEvent, 'OBSERVATION_FAILED'>>(),
			REFRESH_SYNC: types<EventPayload<ReaderExperienceEvent, 'REFRESH_SYNC'>>(),
			FULLSCREEN_CHANGED: types<EventPayload<ReaderExperienceEvent, 'FULLSCREEN_CHANGED'>>(),
			FULLSCREEN_OBSERVED: types<EventPayload<ReaderExperienceEvent, 'FULLSCREEN_OBSERVED'>>()
		},
		input: types<Input>(),
		tags: types<string>(),
		children: {
			attachmentIdentity: types<import('xstate').ActorRefFrom<typeof attachmentIdentity>>(),
			identity: types<import('xstate').ActorRefFrom<typeof identityLogic>>(),
			observation: types<import('xstate').ActorRefFrom<typeof observation>>(),
			viewport: types<import('xstate').ActorRefFrom<typeof viewportMachine>>(),
			receipts: types<import('xstate').ActorRefFrom<typeof syncOwnerMachine>>(),
			fullscreenEntry: types<import('xstate').ActorRefFrom<typeof fullscreenEntry>>(),
			fullscreenExit: types<import('xstate').ActorRefFrom<typeof fullscreenExit>>(),
			fullscreenObservation: types<import('xstate').ActorRefFrom<typeof fullscreenObservation>>()
		}
	},
	actors: {
		attachmentIdentity,
		identity: identityLogic,
		observation,
		viewport: viewportMachine,
		receipts: syncOwnerMachine,
		fullscreenEntry,
		fullscreenExit,
		fullscreenObservation
	},
	guards: {
		fullscreenSupported: ({ context }: { context: Context }) =>
			context.display?.supported() === true,
		fullscreenActive: ({ context }: { context: Context }) => context.display?.active() === true,
		fullscreenInactive: ({ context }: { context: Context }) => context.display?.active() !== true,
		currentViewport: ({ context, event }: { context: Context; event: ReaderExperienceEvent }) =>
			'attachmentId' in event && event.attachmentId === context.attachment?.id,
		current: ({ context }: { context: Context }) => !!context.capability?.isCurrent(),
		accepting: ({ value }: { value: import('xstate').StateValue }) =>
			matchesState({ active: { control: 'accepting' } }, value),
		closing: ({ value }: { value: import('xstate').StateValue }) =>
			matchesState({ active: { control: 'closing' } }, value),
		dataReady: ({ value }: { value: import('xstate').StateValue }) =>
			matchesState({ active: { data: { observing: 'ready' } } }, value),
		validChange: ({ context, event }: { context: Context; event: ReaderExperienceEvent }) =>
			event.type === 'CHANGE' && canQueueReaderChange(context.queue, event.change),
		queued: ({ context }: { context: Context }) => context.queue.length > 0,
		ownCompletion: ({ context, event }: { context: Context; event: Event }) =>
			'actorId' in event && event.actorId === context.write?.id
	},
	actions: {
		updateRows: ({ context, event }: { context: Context; event: ReaderExperienceEvent }) =>
			event.type === 'ROWS'
				? {
						context: {
							rows: event.rows,
							drafts: remainingDrafts(context.drafts, event.rows),
							progress: mergeReadingProgress(
								context.progress,
								projectReaderState(event.rows).progress
							)
						}
					}
				: { context: {} },
		enqueue: ({ context, event }: { context: Context; event: ReaderExperienceEvent }) =>
			event.type === 'CHANGE'
				? {
						context: {
							queue: replaceDesired(context.queue, event.change),
							drafts: replaceDesired(context.drafts, event.change)
						}
					}
				: { context: {} },
		dropIssuedDraft: ({ context }: { context: Context }) => ({
			context: {
				drafts: context.drafts.filter(
					(change) => JSON.stringify(change) !== JSON.stringify(context.issued)
				)
			}
		})
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
		pendingAttachment: undefined,
		progress: {},
		display: undefined,
		sync: {}
	}),
	states: {
		admitting: {
			type: 'choice',
			choice: (args) => {
				if (args.guards.current(args)) {
					return { target: 'active' }
				}
				return { target: 'closed' }
			}
		},
		active: {
			type: 'parallel' as const,
			invoke: {
				id: 'receipts',
				src: 'receipts',
				input: ({ self }) => ({ reportTo: self }),
				onError: { target: '#reader-experience.active.synchronization.failed' }
			},
			always: (args) => {
				if (
					!(
						matchesState({ active: { control: 'closing' } }, args.value) &&
						!args.guards.queued(args) &&
						!matchesState({ active: { writer: 'writing' } }, args.value) &&
						matchesState({ active: { focus: 'normal' } }, args.value) &&
						matchesState({ active: { viewport: 'detached' } }, args.value)
					)
				)
					return
				return { target: 'closed' }
			},
			on: {
				SYNC: (args, enq) => {
					const { event } = args
					enq.raise({ type: 'REFRESH_SYNC' as const })
					return { context: { sync: { ...args.context.sync, [event.id]: event.status } } }
				}
			},
			states: {
				control: {
					initial: 'accepting',
					states: { accepting: { on: { SHUTDOWN: { target: 'closing' } } }, closing: {} }
				},
				data: {
					initial: 'observing',
					states: {
						observing: {
							initial: 'loading',
							invoke: {
								id: 'observation',
								src: 'observation',
								input: ({ context }: { context: Context }) => context.capability,
								onError: { target: 'failed' }
							},
							on: {
								ROWS: (args) => {
									if (!args.guards.current(args)) return
									return { context: args.actions.updateRows(args).context }
								},
								OBSERVATION_FAILED: { target: 'failed' },
								SHUTDOWN: { target: 'closed' }
							},
							states: {
								loading: {
									on: {
										ROWS: (args) => {
											if (!args.guards.current(args)) return
											return { target: 'ready', context: args.actions.updateRows(args).context }
										}
									}
								},
								ready: {}
							}
						},
						failed: {
							meta: { name: t('reader.data_unavailable'), variant: 'error' as const, priority: 4 },
							on: { SHUTDOWN: { target: 'closed' } }
						},
						closed: {}
					}
				},
				focus: {
					initial: 'normal',
					states: {
						normal: {
							entry: () => {
								return { context: { display: undefined } }
							},
							on: {
								FOCUS: (args) => {
									if (
										!(
											matchesState({ active: { control: 'accepting' } }, args.value) &&
											args.guards.current(args)
										)
									)
										return
									return {
										target: 'focused',
										context: { display: args.context.attachment?.surface.fullscreen }
									}
								}
							}
						},
						focused: {
							initial: 'admitting',
							states: {
								admitting: {
									type: 'choice',
									choice: (args) => {
										if (args.guards.fullscreenSupported(args)) {
											return { target: 'native' }
										}
										return { target: 'fallback' }
									}
								},
								native: {
									initial: 'registering',
									invoke: {
										id: 'fullscreenObservation',
										src: 'fullscreenObservation',
										input: ({ context }: { context: Context }) => required(context.display),
										onError: { target: '#reader-fallback' }
									},
									states: {
										registering: {
											on: {
												FULLSCREEN_OBSERVED: { target: 'opening' },
												SHOW_CONTROLS: { target: '#reader-experience.active.focus.normal' },
												SHUTDOWN: { target: '#reader-experience.active.focus.normal' },
												DETACH: { target: '#reader-experience.active.focus.normal' }
											}
										},

										opening: {
											initial: 'requested',
											invoke: {
												id: 'fullscreenEntry',
												src: 'fullscreenEntry',
												input: ({ context }: { context: Context }) => required(context.display),
												onDone: (args) => {
													if (
														matchesState(
															{
																active: {
																	focus: { focused: { native: { opening: 'cancelling' } } }
																}
															},
															args.value
														)
													) {
														return { target: 'exiting' }
													}
													if (args.guards.fullscreenActive(args)) {
														return { target: 'fullscreen' }
													}
													return { target: '#reader-fallback' }
												},
												onError: (args) => {
													if (
														matchesState(
															{
																active: {
																	focus: { focused: { native: { opening: 'cancelling' } } }
																}
															},
															args.value
														)
													) {
														return { target: '#reader-experience.active.focus.normal' }
													}
													return { target: '#reader-fallback' }
												}
											},
											on: {
												SHOW_CONTROLS: { target: '.cancelling' },
												SHUTDOWN: { target: '.cancelling' },
												DETACH: { target: '.cancelling' },
												FULLSCREEN_CHANGED: (args) => {
													if (!args.guards.fullscreenInactive(args)) return
													return { target: '.cancelling' }
												}
											},
											states: { requested: {}, cancelling: {} }
										},
										fullscreen: {
											on: {
												SHOW_CONTROLS: { target: 'exiting' },
												SHUTDOWN: { target: 'exiting' },
												DETACH: { target: 'exiting' },
												FULLSCREEN_CHANGED: (args) => {
													if (!args.guards.fullscreenInactive(args)) return
													return { target: '#reader-experience.active.focus.normal' }
												}
											}
										},
										exiting: {
											initial: 'checking',
											states: {
												checking: {
													type: 'choice',
													choice: (args) => {
														if (args.guards.fullscreenActive(args)) {
															return { target: 'requesting' }
														}
														return { target: '#reader-experience.active.focus.normal' }
													}
												},
												requesting: {
													invoke: {
														id: 'fullscreenExit',
														src: 'fullscreenExit',
														input: ({ context }: { context: Context }) => required(context.display),
														onDone: { target: '#reader-experience.active.focus.normal' },
														onError: { target: '#reader-experience.active.focus.normal' }
													}
												}
											}
										}
									}
								},

								fallback: {
									id: 'reader-fallback',
									on: {
										SHOW_CONTROLS: { target: '#reader-experience.active.focus.normal' },
										SHUTDOWN: { target: '#reader-experience.active.focus.normal' },
										DETACH: { target: '#reader-experience.active.focus.normal' }
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
								ATTACH: (args) => {
									if (
										!(
											matchesState({ active: { control: 'accepting' } }, args.value) &&
											args.guards.current(args)
										)
									)
										return
									const { event } = args
									return {
										target: 'identifying',
										context: {
											pendingAttachment: {
												surface: nativeReaderSurface(event),
												documentId: event.documentId
											}
										}
									}
								},
								ATTACH_SURFACE: (args) => {
									if (
										!(
											matchesState({ active: { control: 'accepting' } }, args.value) &&
											args.guards.current(args)
										)
									)
										return
									const { event } = args
									return {
										target: 'identifying',
										context: {
											pendingAttachment: {
												surface: event.surface,
												documentId: event.documentId
											}
										}
									}
								}
							}
						},
						identifying: {
							invoke: {
								id: 'attachmentIdentity',
								src: 'attachmentIdentity',
								onError: { target: 'failed' }
							},
							on: {
								ATTACHMENT_IDENTIFIED: ({ context, event }) => ({
									target: 'waiting',
									context: {
										attachment: { ...required(context.pendingAttachment), id: event.id },
										pendingAttachment: undefined
									}
								}),
								DETACH: { target: 'detached', context: { pendingAttachment: undefined } },
								SHUTDOWN: { target: 'detached', context: { pendingAttachment: undefined } }
							}
						},
						waiting: {
							always: (args) => {
								if (!matchesState({ active: { data: { observing: 'ready' } } }, args.value)) return
								return { target: 'owning' }
							},
							on: {
								DETACH: () => {
									return { target: 'detached', context: { attachment: undefined } }
								},
								SHUTDOWN: () => {
									return { target: 'detached', context: { attachment: undefined } }
								}
							}
						},
						owning: {
							initial: 'active',
							invoke: {
								id: 'viewport',
								src: 'viewport',
								input: ({ context }: { context: Context }) => ({
									...required(context.attachment).surface.viewport,
									attachmentId: required(context.attachment).id,
									position: projectReaderState(context.rows).positions[
										required(context.attachment).documentId
									]
								}),
								onError: { target: 'failed' },
								onDone: (args) => {
									const { event } = args
									if (
										args.guards.current(args) &&
										positionSchema.safeParse(event.output.position).success &&
										!matchesState({ active: { writer: 'uncertain' } }, args.value)
									) {
										return {
											target: 'detached',
											context: (({ context, event }) => {
												const documentId = required(context.attachment).documentId
												const position = required(event.output.position)
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
											})(args)
										}
									}
									return { target: 'detached', context: { attachment: undefined } }
								}
							},
							on: {
								REFLOW: (args, enq) => {
									enq.sendTo('viewport', { type: 'REFLOW' as const })
								},
								FOCUS: (args, enq) => {
									enq.sendTo('viewport', { type: 'REFLOW' as const })
								},
								SHOW_CONTROLS: (args, enq) => {
									enq.sendTo('viewport', { type: 'REFLOW' as const })
								},
								FULLSCREEN_CHANGED: (args, enq) => {
									enq.sendTo('viewport', { type: 'REFLOW' as const })
								},
								VIEWPORT_FAILED: (args) => {
									if (!args.guards.currentViewport(args)) return
									return { target: 'failed' }
								}
							},
							states: {
								active: {
									on: {
										MEASURE: (args, enq) => {
											const { event } = args
											if (
												!(
													args.guards.currentViewport(args) &&
													args.guards.current(args) &&
													positionSchema.safeParse(event.position).success
												)
											)
												return
											let context = args.context
											let patch = {}
											patch = {
												...patch,
												progress: mergeReadingProgress(context.progress, {
													[required(context.attachment).documentId]: event.position.progress
												})
											}
											context = { ...args.context, ...patch }
											enq.raise({
												type: 'CHANGE' as const,
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
											})
											return { context: patch }
										},
										DETACH: (args, enq) => {
											enq.sendTo('viewport', { type: 'DETACH' as const })
											return { target: 'closing' }
										},
										SHUTDOWN: (args, enq) => {
											enq.sendTo('viewport', { type: 'DETACH' as const })
											return { target: 'closing' }
										}
									}
								},
								closing: { on: { DETACH: {}, SHUTDOWN: {} } }
							}
						},
						failed: {
							meta: { name: t('reader.data_unavailable'), variant: 'error' as const, priority: 4 },
							on: {
								DETACH: () => {
									return { target: 'detached', context: { attachment: undefined } }
								},
								SHUTDOWN: () => {
									return { target: 'detached', context: { attachment: undefined } }
								}
							}
						}
					}
				},
				synchronization: {
					initial: 'healthy',
					on: { REFRESH_SYNC: { target: '.routing' } },
					states: {
						routing: {
							type: 'choice',
							choice: (args) => {
								if (Object.values(args.context.sync).includes('rejected')) {
									return { target: 'failed' }
								}
								return { target: 'healthy' }
							}
						},
						healthy: {},
						failed: {
							meta: {
								name: t('status.failed_subject', { subject: t('actions.sync') }),
								variant: 'error' as const,
								priority: 1
							}
						}
					}
				},
				writer: {
					initial: 'idle',
					on: {
						CHANGE: (args) => {
							if (
								!(
									matchesState({ active: { control: 'accepting' } }, args.value) &&
									args.guards.current(args) &&
									matchesState({ active: { data: { observing: 'ready' } } }, args.value) &&
									args.guards.validChange(args)
								)
							)
								return
							return { target: '.debouncing', context: args.actions.enqueue(args).context }
						},
						SHUTDOWN: { target: '.routing' }
					},
					states: {
						idle: {
							always: (args) => {
								if (!args.guards.queued(args)) return
								return { target: 'routing' }
							}
						},
						debouncing: {
							always: (args) => {
								if (!args.context.queue.some((change) => change.field !== 'position')) return
								return { target: 'routing' }
							},
							after: { 1000: { target: 'routing' } },
							on: { DETACH: { target: 'routing' } }
						},
						routing: {
							always: (args) => {
								if (!args.guards.current(args)) {
									return { target: 'idle', context: { queue: [], drafts: [] } }
								}
								if (args.guards.current(args) && args.guards.queued(args)) {
									return { target: 'identifyingWrite' }
								}
								return { target: 'idle' }
							}
						},
						identifyingWrite: {
							invoke: {
								id: 'identity',
								src: 'identity',
								onDone: ({ event }) => ({
									target: 'writing',
									context: { operationId: event.output }
								})
							}
						},
						writing: {
							exit: (args, enq) => {
								enq.stop(required(args.context.write))
							},
							entry: (args, enq) => {
								return {
									context: (({ context, spawn }) => {
										const issued = required(context.queue[0]),
											operationId = context.operationId
										return {
											issued,
											operationId,
											queue: context.queue.slice(1),
											write: (() => {
												const ref = required(context.capability).spawnWrite(
													spawn,
													issued,
													operationId,
													context.rows
												)
												enq.subscribeTo(ref, {
													done: (
														output
													):
														| {
																type: 'READER_WRITE_DONE'
																actorId: string
																output: ReaderStageResult
														  }
														| { type: 'READER_WRITE_ERROR'; actorId: string; error: unknown } => ({
														type: 'READER_WRITE_DONE',
														actorId: ref.id,
														output
													}),
													error: (
														error
													):
														| {
																type: 'READER_WRITE_DONE'
																actorId: string
																output: ReaderStageResult
														  }
														| { type: 'READER_WRITE_ERROR'; actorId: string; error: unknown } => ({
														type: 'READER_WRITE_ERROR',
														actorId: ref.id,
														error
													})
												})
												return ref
											})()
										}
									})({ ...args, spawn: enq.spawn })
								}
							},
							on: {
								CHANGE: (args) => {
									if (
										!(
											matchesState({ active: { control: 'accepting' } }, args.value) &&
											args.guards.current(args) &&
											matchesState({ active: { data: { observing: 'ready' } } }, args.value) &&
											args.guards.validChange(args)
										)
									)
										return
									return { context: args.actions.enqueue(args).context }
								},
								SHUTDOWN: {},
								READER_WRITE_DONE: (args, enq) => {
									const { event } = args
									if (
										args.guards.ownCompletion(args) &&
										(!event.output || event.output.settlement.kind === 'unresolved')
									) {
										return {
											target: 'uncertain',
											context: { queue: [], drafts: [], write: undefined }
										}
									}
									if (
										args.guards.ownCompletion(args) &&
										event.output?.settlement.kind === 'locallyPersisted'
									) {
										let context = args.context
										let patch = {}
										patch = { ...patch, ...args.actions.dropIssuedDraft(args).context }
										context = { ...args.context, ...patch }
										enq.sendTo('receipts', {
											type: 'WATCH' as const,
											id: context.operationId,
											receipts:
												event.output?.settlement.kind === 'locallyPersisted'
													? [event.output.settlement.workspace]
													: []
										})
										patch = {
											...patch,
											sync: {
												...context.sync,
												[context.operationId]: 'pending'
											},
											write: undefined
										}
										context = { ...args.context, ...patch }
										return { target: 'routing', context: patch }
									}
									if (args.guards.ownCompletion(args)) {
										return {
											target: 'failed',
											context: { ...args.actions.dropIssuedDraft(args).context, write: undefined }
										}
									}
								},
								READER_WRITE_ERROR: (args) => {
									if (!args.guards.ownCompletion(args)) return
									return {
										target: 'uncertain',
										context: { queue: [], drafts: [], write: undefined }
									}
								}
							}
						},
						failed: {
							meta: { name: t('reader.save_failed'), variant: 'error' as const, priority: 2 },
							always: (args) => {
								if (!args.guards.queued(args)) return
								return { target: 'routing' }
							}
						},
						uncertain: {
							meta: { name: t('status.save_unknown'), variant: 'error' as const, priority: 3 },
							on: { CHANGE: {}, ATTACH: { target: 'idle' }, SHUTDOWN: {} }
						}
					}
				}
			}
		},
		closed: {
			type: 'final' as const,
			entry: () => {
				return {
					context: {
						rows: [],
						queue: [],
						drafts: [],
						attachment: undefined,
						write: undefined,
						capability: undefined,
						issued: undefined,
						progress: {},
						display: undefined,
						operationId: '',
						sync: {}
					}
				}
			}
		}
	}
})
function projectReaderExperience(
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

// Immutable snapshots share one projection across the shell, reader and library.
// Recheck the account boundary before consulting the cache.
const readerViews = new WeakMap<
	SnapshotFrom<typeof readerExperienceMachine>,
	ReturnType<typeof projectReaderExperience>
>()
const emptyReaderView = projectReaderExperience(undefined)
export function selectReaderExperience(
	snapshot: SnapshotFrom<typeof readerExperienceMachine> | undefined
) {
	if (!snapshot?.context.capability?.isCurrent()) return emptyReaderView
	const cached = readerViews.get(snapshot)
	if (cached) return cached
	const view = projectReaderExperience(snapshot)
	readerViews.set(snapshot, view)
	return view
}
