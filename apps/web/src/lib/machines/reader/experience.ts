import { READER_REPLY_TIMEOUT_MS, monotonicNow } from '../../contracts/resource-waits.js'
import { createOwnedOperation } from 'delightful-local-first/lifecycle/operation/workflow'
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

import type { ReaderCapability, ReaderStageResult } from '../../contracts/reader.js'
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

type Input = {
	capability: ReaderCapability | undefined
	viewportReplyTimeoutMs?: number
	now?: () => number
}
type Attachment = { documentId: string; surface: ReaderSurface }
type OwnedAttachment = Attachment & { id: string }
export type ReaderExperienceEvent =
	| { type: 'MEASURE'; position: ReadingPosition; attachmentId: string }
	| { type: 'VIEWPORT_FAILED'; attachmentId: string; reason?: 'failed' | 'overdue' }
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
				| 'FULLSCREEN_CHANGED'
				| 'FULLSCREEN_OBSERVED'
	  }
	| SyncReport
type Context = Input & {
	rows: ReaderOperation[]
	queue: ReaderChange[]
	drafts: ReaderChange[]
	operationId: string
	issued: ReaderChange | undefined
	attachment: OwnedAttachment | undefined
	pendingAttachment: Attachment | undefined
	progress: Record<string, number>
	display: FullscreenSurface | undefined
	retiringSurfaces: ReaderSurface[]
	sync: Record<string, 'pending' | 'accepted' | 'rejected'>
}
// Keep attachment admission synchronous so native fullscreen retains user activation.
const attachmentIdentity = createCallbackLogic<never>(({ sendBack }) => {
	sendBack({ type: 'ATTACHMENT_IDENTIFIED', id: crypto.randomUUID() })
})
const observation = createCallbackLogic<ReaderExperienceEvent, ReaderCapability | undefined>(
	({ input, sendBack }) =>
		input?.subscribe(
			(rows) => sendBack({ type: 'ROWS', rows }),
			() => sendBack({ type: 'OBSERVATION_FAILED' })
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
		const change = () => sendBack({ type: 'FULLSCREEN_CHANGED' })
		const release = input.observe(change)
		sendBack({ type: 'FULLSCREEN_OBSERVED' })
		return release
	}
)

function retirePendingAttachment(context: Context) {
	return {
		pendingAttachment: undefined,
		retiringSurfaces: context.pendingAttachment
			? [...context.retiringSurfaces, context.pendingAttachment.surface]
			: context.retiringSurfaces
	}
}
function retireAttachments(context: Context) {
	return {
		attachment: undefined,
		pendingAttachment: undefined,
		retiringSurfaces: [
			...new Set([
				...context.retiringSurfaces,
				...(context.attachment ? [context.attachment.surface] : []),
				...(context.pendingAttachment ? [context.pendingAttachment.surface] : [])
			])
		]
	}
}
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
type ReaderWriteInput = { change: ReaderChange; operationId: string; observed: ReaderOperation[] }
const writeOperation = createOwnedOperation<ReaderWriteInput, ReaderStageResult>()
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
			FULLSCREEN_CHANGED: types<EventPayload<ReaderExperienceEvent, 'FULLSCREEN_CHANGED'>>(),
			FULLSCREEN_OBSERVED: types<EventPayload<ReaderExperienceEvent, 'FULLSCREEN_OBSERVED'>>()
		},
		internalEvents: { REFRESH_SYNC: types() },
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
			fullscreenObservation: types<import('xstate').ActorRefFrom<typeof fullscreenObservation>>(),
			writeOperation: types<import('xstate').ActorRefFrom<typeof writeOperation>>()
		}
	},
	states: {
		admitting: { id: 'reader-experience.admitting' },
		active: {
			id: 'reader-experience.active',
			states: {
				control: {
					id: 'reader-experience.active.control',
					states: {
						accepting: { id: 'reader-experience.active.control.accepting' },
						closing: { id: 'reader-experience.active.control.closing' }
					}
				},
				data: {
					id: 'reader-experience.active.data',
					states: {
						observing: {
							id: 'reader-experience.active.data.observing',
							states: {
								loading: { id: 'reader-experience.active.data.observing.loading' },
								ready: { id: 'reader-experience.active.data.observing.ready' }
							}
						},
						failed: { id: 'reader-experience.active.data.failed' },
						closed: { id: 'reader-experience.active.data.closed' }
					}
				},
				focus: {
					id: 'reader-experience.active.focus',
					states: {
						normal: { id: 'reader-experience.active.focus.normal' },
						focused: {
							id: 'reader-experience.active.focus.focused',
							states: {
								admitting: { id: 'reader-experience.active.focus.focused.admitting' },
								native: {
									id: 'reader-experience.active.focus.focused.native',
									states: {
										registering: {
											id: 'reader-experience.active.focus.focused.native.registering'
										},
										opening: {
											id: 'reader-experience.active.focus.focused.native.opening',
											states: {
												requested: {
													id: 'reader-experience.active.focus.focused.native.opening.requested'
												},
												cancelling: {
													id: 'reader-experience.active.focus.focused.native.opening.cancelling'
												}
											}
										},
										fullscreen: { id: 'reader-experience.active.focus.focused.native.fullscreen' },
										exiting: {
											id: 'reader-experience.active.focus.focused.native.exiting',
											states: {
												checking: {
													id: 'reader-experience.active.focus.focused.native.exiting.checking'
												},
												requesting: {
													id: 'reader-experience.active.focus.focused.native.exiting.requesting'
												}
											}
										}
									}
								},
								fallback: { id: 'reader-fallback' }
							}
						}
					}
				},
				viewport: {
					id: 'reader-experience.active.viewport',
					states: {
						detached: { id: 'reader-experience.active.viewport.detached' },
						identifying: { id: 'reader-experience.active.viewport.identifying' },
						waiting: { id: 'reader-experience.active.viewport.waiting' },
						owning: {
							id: 'reader-experience.active.viewport.owning',
							states: {
								active: { id: 'reader-experience.active.viewport.owning.active' },
								overdue: { id: 'reader-experience.active.viewport.owning.overdue' },
								unavailable: { id: 'reader-experience.active.viewport.owning.unavailable' },
								closing: { id: 'reader-experience.active.viewport.owning.closing' }
							}
						},
						failed: { id: 'reader-experience.active.viewport.failed' }
					}
				},
				synchronization: {
					id: 'reader-experience.active.synchronization',
					states: {
						routing: { id: 'reader-experience.active.synchronization.routing' },
						healthy: { id: 'reader-experience.active.synchronization.healthy' },
						failed: { id: 'reader-experience.active.synchronization.failed' }
					}
				},
				writer: {
					id: 'reader-experience.active.writer',
					states: {
						idle: { id: 'reader-experience.active.writer.idle' },
						debouncing: { id: 'reader-experience.active.writer.debouncing' },
						routing: { id: 'reader-experience.active.writer.routing' },
						identifyingWrite: { id: 'reader-experience.active.writer.identifyingWrite' },
						writing: {
							id: 'reader-experience.active.writer.writing',
							schemas: { input: types<ReaderWriteInput>() }
						},
						failed: { id: 'reader-experience.active.writer.failed' },
						uncertain: { id: 'reader-experience.active.writer.uncertain' }
					}
				}
			}
		},
		closed: { id: 'reader-experience.closed' }
	},
	actors: {
		attachmentIdentity,
		identity: identityLogic,
		observation,
		viewport: viewportMachine,
		receipts: syncOwnerMachine,
		fullscreenEntry,
		fullscreenExit,
		fullscreenObservation,
		writeOperation
	},
	guards: {
		viewportUnavailable: ({ value }: { value: import('xstate').StateValue }) =>
			matchesState({ active: { viewport: { owning: 'unavailable' } } }, value) ||
			matchesState({ active: { viewport: { owning: 'overdue' } } }, value),
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
		queued: ({ context }: { context: Context }) => context.queue.length > 0
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
	on: { ATTACH_SURFACE: ({ event }, enq) => enq(() => event.surface.lifecycle?.released()) },
	context: ({ input }) => ({
		...input,
		rows: [],
		queue: [],
		drafts: [],
		operationId: '',
		issued: undefined,
		attachment: undefined,
		pendingAttachment: undefined,
		progress: {},
		display: undefined,
		retiringSurfaces: [],
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
			type: 'parallel',
			invoke: {
				id: 'receipts',
				src: 'receipts',
				input: ({ self }) => ({ reportTo: self }),
				onError: { target: '#reader-experience.active.synchronization.failed' }
			},
			always: (args, enq) => {
				const released = args.context.retiringSurfaces.filter(
					(surface) =>
						surface !== args.context.attachment?.surface &&
						surface !== args.context.pendingAttachment?.surface &&
						surface.fullscreen !== args.context.display
				)
				if (
					released.length &&
					matchesState({ active: { focus: 'normal' } }, args.value) &&
					!args.guards.queued(args) &&
					!matchesState({ active: { writer: 'writing' } }, args.value)
				) {
					for (const surface of released) enq(() => surface.lifecycle?.released())
					return {
						context: {
							retiringSurfaces: args.context.retiringSurfaces.filter(
								(surface) => !released.includes(surface)
							)
						}
					}
				}
				if (
					!(
						matchesState({ active: { control: 'closing' } }, args.value) &&
						!args.guards.queued(args) &&
						!args.context.pendingAttachment &&
						args.context.retiringSurfaces.length === 0 &&
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
					enq.raise({ type: 'REFRESH_SYNC' })
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
							meta: { name: t('reader.data_unavailable'), variant: 'error', priority: 4 },
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
					on: {
						ATTACH_SURFACE: (args, enq) => {
							const { context, event } = args
							if (
								context.attachment?.surface === event.surface ||
								context.pendingAttachment?.surface === event.surface
							)
								return
							if (
								!args.guards.current(args) ||
								!matchesState({ active: { control: 'accepting' } }, args.value) ||
								matchesState({ active: { viewport: 'failed' } }, args.value)
							) {
								enq(() => event.surface.lifecycle?.released())
								return
							}
							enq(() => event.surface.lifecycle?.accepted())
							enq.raise({ type: 'SHOW_CONTROLS' })
							return {
								target: '.identifying',
								reenter: true,
								context: {
									...retireAttachments(context),
									pendingAttachment: { surface: event.surface, documentId: event.documentId }
								}
							}
						}
					},
					states: {
						detached: {
							always: (args) =>
								args.context.pendingAttachment && args.guards.accepting(args)
									? { target: 'identifying' }
									: undefined,
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
								ATTACH_SURFACE: (args, enq) => {
									if (
										!(
											matchesState({ active: { control: 'accepting' } }, args.value) &&
											args.guards.current(args)
										)
									) {
										enq(() => args.event.surface.lifecycle?.released())
										return
									}
									const { event } = args
									enq(() => event.surface.lifecycle?.accepted())
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
								DETACH: ({ context }) => ({
									target: 'detached',
									context: {
										pendingAttachment: undefined,
										retiringSurfaces: [
											...context.retiringSurfaces,
											required(context.pendingAttachment).surface
										]
									}
								}),
								SHUTDOWN: ({ context }) => ({
									target: 'detached',
									context: {
										pendingAttachment: undefined,
										retiringSurfaces: [
											...context.retiringSurfaces,
											required(context.pendingAttachment).surface
										]
									}
								})
							}
						},
						waiting: {
							always: (args) => {
								if (!matchesState({ active: { data: { observing: 'ready' } } }, args.value)) return
								return { target: 'owning' }
							},
							on: {
								DETACH: ({ context }) => {
									return {
										target: 'detached',
										context: {
											attachment: undefined,
											retiringSurfaces: [
												...context.retiringSurfaces,
												required(context.attachment).surface
											]
										}
									}
								},
								SHUTDOWN: ({ context }) => {
									return {
										target: 'detached',
										context: {
											attachment: undefined,
											retiringSurfaces: [
												...context.retiringSurfaces,
												required(context.attachment).surface
											]
										}
									}
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
									replyTimeoutMs: context.viewportReplyTimeoutMs ?? READER_REPLY_TIMEOUT_MS,
									now: context.now ?? monotonicNow,
									position: projectReaderState(context.rows).positions[
										required(context.attachment).documentId
									]
								}),
								onError: { target: '.unavailable' },
								onDone: (args) => {
									const { event } = args
									if (event.output.outcome !== 'closed')
										return {
											target: args.guards.closing(args) ? 'detached' : 'failed',
											context: retireAttachments(args.context)
										}
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
													attachment: undefined,
													retiringSurfaces: [
														...context.retiringSurfaces,
														required(context.attachment).surface
													]
												}
											})(args)
										}
									}
									return {
										target: 'detached',
										context: {
											attachment: undefined,
											retiringSurfaces: [
												...args.context.retiringSurfaces,
												required(args.context.attachment).surface
											]
										}
									}
								}
							},
							on: {
								ATTACH_SURFACE: (args, enq) => {
									const { context, event } = args
									if (
										context.attachment?.surface === event.surface ||
										context.pendingAttachment?.surface === event.surface
									)
										return {}
									if (
										!args.guards.current(args) ||
										!matchesState({ active: { control: 'accepting' } }, args.value)
									) {
										enq(() => event.surface.lifecycle?.released())
										return {}
									}
									enq(() => event.surface.lifecycle?.accepted())
									enq.raise({ type: 'SHOW_CONTROLS' })
									enq.sendTo('viewport', { type: 'DETACH' })
									return {
										target: args.guards.viewportUnavailable(args) ? '.unavailable' : '.closing',
										context: {
											pendingAttachment: { surface: event.surface, documentId: event.documentId },
											retiringSurfaces: context.pendingAttachment
												? [...context.retiringSurfaces, context.pendingAttachment.surface]
												: context.retiringSurfaces
										}
									}
								},
								REFLOW: (args, enq) => {
									enq.sendTo('viewport', { type: 'REFLOW' })
								},
								FOCUS: (args, enq) => {
									enq.sendTo('viewport', { type: 'REFLOW' })
								},
								SHOW_CONTROLS: (args, enq) => {
									enq.sendTo('viewport', { type: 'REFLOW' })
								},
								FULLSCREEN_CHANGED: (args, enq) => {
									enq.sendTo('viewport', { type: 'REFLOW' })
								},
								VIEWPORT_FAILED: (args) => {
									if (!args.guards.currentViewport(args)) return
									return { target: args.event.reason === 'overdue' ? '.overdue' : '.unavailable' }
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
											})
											return { context: patch }
										},
										DETACH: (args, enq) => {
											enq.sendTo('viewport', { type: 'DETACH' })
											return { target: 'closing' }
										},
										SHUTDOWN: (args, enq) => {
											enq.sendTo('viewport', { type: 'DETACH' })
											return { target: 'closing' }
										}
									}
								},
								overdue: {
									meta: { name: t('reader.data_unavailable'), variant: 'error', priority: 4 },
									on: {
										DETACH: ({ context }) => ({ context: retirePendingAttachment(context) }),
										SHUTDOWN: ({ context }) => ({ context: retirePendingAttachment(context) })
									}
								},
								unavailable: {
									meta: { name: t('reader.data_unavailable'), variant: 'error', priority: 4 },
									on: {
										DETACH: ({ context }) => ({ context: retirePendingAttachment(context) }),
										SHUTDOWN: ({ context }) => ({ context: retirePendingAttachment(context) })
									}
								},
								closing: {
									on: {
										DETACH: ({ context }) => ({ context: retirePendingAttachment(context) }),
										SHUTDOWN: ({ context }) => ({ context: retirePendingAttachment(context) })
									}
								}
							}
						},
						failed: {
							meta: { name: t('reader.data_unavailable'), variant: 'error', priority: 4 },
							on: {
								DETACH: ({ context }) => {
									return {
										target: 'detached',
										context: retireAttachments(context)
									}
								},
								SHUTDOWN: ({ context }) => {
									return {
										target: 'detached',
										context: retireAttachments(context)
									}
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
								variant: 'error',
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
								onDone: ({ context, event }) => ({
									target: 'writing',
									input: {
										change: required(context.queue[0]),
										operationId: event.output,
										observed: context.rows
									},
									context: {
										operationId: event.output,
										issued: required(context.queue[0]),
										queue: context.queue.slice(1)
									}
								})
							}
						},
						writing: {
							invoke: {
								id: 'writeOperation',
								src: 'writeOperation',
								input: ({ context, input }) => ({
									operationId: input.operationId,
									input,
									spawn: (spawn, input) =>
										required(context.capability).spawnWrite(
											spawn,
											input.change,
											input.operationId,
											input.observed
										)
								}),
								onDone: (args, enq) => {
									const operation = args.event.output
									if (operation.kind === 'failed')
										return { target: 'uncertain', context: { queue: [], drafts: [] } }
									const output = operation.output
									if (!output || output.settlement.kind === 'unresolved')
										return { target: 'uncertain', context: { queue: [], drafts: [] } }
									if (output.settlement.kind === 'locallyPersisted') {
										enq.sendTo('receipts', {
											type: 'WATCH',
											id: args.context.operationId,
											receipts: [output.settlement.workspace]
										})
										return {
											target: 'routing',
											context: {
												...args.actions.dropIssuedDraft(args).context,
												sync: { ...args.context.sync, [args.context.operationId]: 'pending' }
											}
										}
									}
									return { target: 'failed', context: args.actions.dropIssuedDraft(args).context }
								},
								onError: { target: 'uncertain', context: { queue: [], drafts: [] } }
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
								SHUTDOWN: (_, enq) => {
									enq.sendTo('writeOperation', { type: 'DRAIN' })
								}
							}
						},
						failed: {
							meta: { name: t('reader.save_failed'), variant: 'error', priority: 2 },
							always: (args) => {
								if (!args.guards.queued(args)) return
								return { target: 'routing' }
							}
						},
						uncertain: {
							meta: { name: t('status.save_unknown'), variant: 'error', priority: 3 },
							on: { CHANGE: {}, ATTACH: { target: 'idle' }, SHUTDOWN: {} }
						}
					}
				}
			}
		},
		closed: {
			type: 'final',
			entry: () => {
				return {
					context: {
						rows: [],
						queue: [],
						drafts: [],
						attachment: undefined,
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
