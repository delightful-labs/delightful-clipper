import { assign, enqueueActions, fromCallback, sendTo, setup, stopChild } from 'xstate'
import type { SnapshotFrom } from 'xstate'
import { t } from '../../localization/index.js'
import { normalizedSource } from '../../capture/source.js'
import type { WorkflowMessage } from '../../contracts/feedback.js'
import type { LibraryCapability, LibraryEvent, SaveRef } from '../../contracts/library.js'
import type { ArticleSaveResult, LibraryArticle } from '../../contracts/articles.js'
import type { QueueControl } from '../../contracts/article-worker.js'
import type { ReadResult } from '../../contracts/storage.js'
import { syncOwnerMachine } from '../storage/sync-owner.js'
import { readRecordMachine } from '../storage/read.js'
function required<T>(v: T | undefined): T {
	if (v === undefined) throw new Error('Library unavailable')
	return v
}
type Context = {
	capability: LibraryCapability | undefined
	closing: boolean
	writing: boolean
	workerClosed: boolean
	saveRef: SaveRef | undefined
	url: string
	captureId: string
	captureReady: boolean
	readerId: string
	readerGeneration: number
	reader: ReadResult | undefined
	rows: LibraryArticle[]
	listFailed: boolean
	sync: Record<string, 'pending' | 'accepted' | 'rejected'>
	failure: string
	backgroundId: string
	backgroundCancelable: boolean
	background: Record<string, WorkflowMessage>
}
type Meta = {
	captureMessage?: (c: Context) => WorkflowMessage
	readerMessage?: (c: Context) => WorkflowMessage
}
function syncMessage(status: 'pending' | 'accepted' | 'rejected'): WorkflowMessage {
	return {
		text: t(
			status === 'accepted'
				? 'capture.status.synced'
				: status === 'rejected'
					? 'capture.status.rejected'
					: 'library.sync_pending'
		),
		variant: status === 'rejected' ? 'error' : 'info'
	}
}
function failureMessage(code: string): WorkflowMessage {
	return {
		text: t(
			code === 'unknown'
				? 'capture.status.unknown'
				: code === 'canceled'
					? 'capture.status.canceled'
					: code === 'sessionUnavailable'
						? 'capture.errors.session_unavailable'
						: code === 'rateLimited'
							? 'capture.errors.rate_limited'
							: 'capture.status.failed'
		),
		variant: 'error'
	}
}
const actors = {
	collection: fromCallback<LibraryEvent, LibraryCapability | undefined>(({ input, sendBack }) => {
		try {
			return input?.subscribe(
				(rows) => sendBack({ type: 'ROWS', rows }),
				() => sendBack({ type: 'LIST_FAILED' })
			)
		} catch {
			sendBack({ type: 'LIST_FAILED' })
			return
		}
	}),
	worker: fromCallback<QueueControl, LibraryCapability | undefined>(
		({ input, receive, sendBack }) => {
			if (!input) {
				sendBack({ type: 'BACKGROUND_CLOSED' })
				return
			}
			try {
				const resource = input.worker(sendBack)
				receive(resource.send)
				return () => {
					void resource.stop()
				}
			} catch {
				sendBack({ type: 'BACKGROUND_ERROR' })
				sendBack({ type: 'BACKGROUND_CLOSED' })
				return
			}
		}
	),
	receipts: syncOwnerMachine,
	read: readRecordMachine
}
export const libraryMachine = setup<
	Context,
	| LibraryEvent
	| { type: `xstate.done.actor.${string}`; actorId: string; output: ArticleSaveResult }
	| { type: `xstate.error.actor.${string}`; actorId: string; error: unknown },
	typeof actors,
	{},
	{ close: undefined; watch: undefined },
	{},
	never,
	string,
	LibraryCapability | undefined,
	undefined,
	{ type: string },
	Meta
>({
	actors,
	actions: {
		close: enqueueActions(({ context, enqueue }) => {
			if (context.saveRef) enqueue.sendTo(context.saveRef, { type: 'SHUTDOWN' })
			enqueue.sendTo('worker', { type: 'STOP' })
			enqueue.sendTo('receipts', { type: 'SHUTDOWN' })
			enqueue.assign({
				closing: true,
				reader: undefined,
				rows: [],
				url: '',
				sync: {},
				background: {},
				backgroundCancelable: false
			})
		}),
		watch: enqueueActions(({ event, enqueue }) => {
			const result =
				event.type === 'BACKGROUND_SAVED'
					? event.result
					: 'output' in event
						? event.output
						: undefined
			if (
				!result ||
				(result.kind !== 'saved' && result.kind !== 'duplicate') ||
				!result.receipts.length
			)
				return
			enqueue.assign({
				sync: ({ context }) => ({ ...context.sync, [result.operationId]: 'pending' })
			})
			enqueue.sendTo('receipts', {
				type: 'WATCH',
				id: result.operationId,
				receipts: result.receipts
			})
		})
	}
}).createMachine({
	id: 'library',
	initial: 'running',
	context: ({ input }) => ({
		capability: input,
		closing: false,
		writing: false,
		workerClosed: false,
		saveRef: undefined,
		url: '',
		captureId: '',
		captureReady: false,
		readerId: '',
		readerGeneration: 0,
		reader: undefined,
		rows: [],
		listFailed: false,
		sync: {},
		failure: '',
		backgroundId: '',
		backgroundCancelable: false,
		background: {}
	}),
	states: {
		running: {
			type: 'parallel',
			invoke: [
				{ id: 'collection', src: 'collection', input: ({ context }) => context.capability },
				{ id: 'worker', src: 'worker', input: ({ context }) => context.capability },
				{ id: 'receipts', src: 'receipts', input: ({ self }) => ({ reportTo: self }) }
			],
			always: {
				guard: ({ context }) => context.closing && !context.writing && context.workerClosed,
				target: 'closed'
			},
			on: {
				SHUTDOWN: { actions: 'close' },
				ROWS: {
					guard: ({ context }) => !context.closing && !!context.capability?.isCurrent(),
					actions: enqueueActions(({ context, event, enqueue }) => {
						enqueue.assign({
							rows: event.rows,
							background: Object.fromEntries(
								Object.entries(context.background).filter(
									([id, message]) =>
										!(
											message.variant === 'error' &&
											event.rows.some((r) => r.id === id && r.contentId && !r.failure)
										)
								)
							),
							listFailed: false,
							captureReady:
								context.captureReady ||
								event.rows.some((r) => r.id === context.captureId && !!r.contentId)
						})
						if (
							context.readerId &&
							context.reader?.kind !== 'available' &&
							event.rows.some((r) => r.id === context.readerId && !!r.contentId)
						)
							enqueue.raise({ type: 'OPEN', id: context.readerId })
					})
				},
				LIST_FAILED: { actions: assign({ listFailed: true }) },
				BACKGROUND_CLOSED: { actions: assign({ workerClosed: true }) },
				BACKGROUND_ERROR: {
					guard: ({ context }) => !context.closing,
					actions: assign({ failure: 'captureFailed' })
				},
				BACKGROUND_STATUS: {
					guard: ({ context }) => !context.closing && !!context.capability?.isCurrent(),
					actions: assign({
						backgroundId: ({ event }) => event.id,
						backgroundCancelable: ({ event }) => event.cancelable,
						background: ({ context, event }) => ({
							...context.background,
							[event.id]: event.message
						})
					})
				},
				BACKGROUND_SAVED: {
					guard: ({ context }) => !context.closing && !!context.capability?.isCurrent(),
					actions: [
						'watch',
						assign({
							background: ({ context, event }) => {
								const next = { ...context.background }
								if ('ready' in event.result && event.result.ready)
									delete next[event.result.operationId]
								return next
							},
							captureReady: ({ context, event }) =>
								context.captureReady ||
								(event.result.operationId === context.captureId &&
									'ready' in event.result &&
									event.result.ready === true)
						})
					]
				},
				RETRY: {
					guard: ({ context }) => !context.closing,
					actions: sendTo('worker', ({ event }) => ({ type: 'RETRY', id: event.id }))
				},
				SYNC: {
					guard: ({ context }) => !context.closing && !!context.capability?.isCurrent(),
					actions: assign({
						sync: ({ context, event }) => ({ ...context.sync, [event.id]: event.status })
					})
				}
			},
			states: {
				capture: {
					initial: 'idle',
					on: {
						ADD: [
							{
								guard: ({ context, event }) => {
									if (context.closing || context.writing || !context.capability?.isCurrent())
										return false
									try {
										normalizedSource(event.url)
										return true
									} catch {
										return false
									}
								},
								target: '.saving',
								actions: assign({ url: ({ event }) => event.url, failure: '', captureReady: false })
							},
							{
								guard: ({ context }) => !context.closing && !context.writing,
								target: '.failed',
								actions: assign({ failure: 'invalidUrl' })
							}
						],
						CANCEL: {
							guard: ({ context }) => !context.writing && context.backgroundCancelable,
							actions: sendTo('worker', ({ context }) => ({
								type: 'CANCEL',
								id: context.backgroundId
							}))
						}
					},
					states: {
						idle: {},
						saving: {
							meta: {
								captureMessage: () => ({ text: t('capture.status.saving'), variant: 'info' })
							},
							initial: 'active',
							entry: assign(({ context, spawn }) => ({
								writing: true,
								saveRef: required(context.capability).spawnSave(
									(logic, options) => spawn(logic, options),
									{ url: context.url }
								)
							})),
							exit: [
								stopChild(({ context }) => required(context.saveRef)),
								assign({ writing: false, saveRef: undefined })
							],
							states: {
								active: {
									on: {
										CANCEL: {
											target: 'stopping',
											actions: sendTo(({ context }) => required(context.saveRef), {
												type: 'SHUTDOWN'
											})
										}
									}
								},
								stopping: {}
							},
							on: {
								'xstate.done.actor.*': [
									{
										guard: ({ context, event }) =>
											context.closing && event.actorId === context.saveRef?.id,
										target: 'canceled'
									},
									{
										guard: ({ context, event }) =>
											event.actorId === context.saveRef?.id &&
											(event.output.kind === 'saved' || event.output.kind === 'duplicate'),
										target: 'saved',
										actions: [
											'watch',
											assign({
												captureId: ({ event }) => event.output.operationId,
												captureReady: ({ event }) =>
													'ready' in event.output && event.output.ready === true,
												failure: ({ event }) =>
													event.output.kind === 'duplicate' ? 'duplicate' : ''
											})
										]
									},
									{
										guard: ({ context, event }) =>
											event.actorId === context.saveRef?.id && event.output.kind === 'interrupted',
										target: 'canceled'
									},
									{
										guard: ({ context, event }) =>
											event.actorId === context.saveRef?.id && event.output.kind === 'failed',
										target: 'failed'
									},
									{
										guard: ({ context, event }) => event.actorId === context.saveRef?.id,
										target: 'uncertain',
										actions: assign({ captureId: ({ event }) => event.output.operationId })
									}
								],
								'xstate.error.actor.*': {
									guard: ({ context, event }) => event.actorId === context.saveRef?.id,
									target: 'uncertain'
								}
							}
						},
						saved: {
							meta: {
								captureMessage: (c) =>
									c.background[c.captureId] ??
									(c.failure === 'duplicate'
										? { text: t('capture.status.duplicate'), variant: 'info' }
										: c.sync[c.captureId] === 'accepted' || c.sync[c.captureId] === 'rejected'
											? syncMessage(required(c.sync[c.captureId]))
											: { text: t('capture.status.saved'), variant: 'info' })
							}
						},
						failed: {
							meta: {
								captureMessage: (c) => ({
									text: t(
										c.failure === 'invalidUrl'
											? 'capture.errors.invalid_url'
											: 'capture.status.save_failed'
									),
									variant: 'error'
								})
							}
						},
						uncertain: {
							meta: {
								captureMessage: () => ({ text: t('capture.status.unknown'), variant: 'error' })
							}
						},
						canceled: {
							meta: {
								captureMessage: () => ({ text: t('capture.status.canceled'), variant: 'info' })
							}
						}
					}
				},
				reading: {
					initial: 'empty',
					on: {
						OPEN: {
							target: '.loading',
							actions: assign({
								readerId: ({ event }) => event.id,
								readerGeneration: ({ context }) => context.readerGeneration + 1,
								reader: undefined
							})
						},
						CLOSE_READER: {
							target: '.empty',
							actions: assign({
								readerId: '',
								reader: undefined,
								readerGeneration: ({ context }) => context.readerGeneration + 1
							})
						},
						READ_RESULT: {
							guard: ({ context, event }) =>
								event.generation === context.readerGeneration &&
								!context.closing &&
								!!context.capability?.isCurrent(),
							target: '.shown',
							actions: assign({ reader: ({ event }) => event.result })
						}
					},
					states: {
						empty: {},
						loading: {
							meta: { readerMessage: () => ({ text: t('reader.loading'), variant: 'info' }) },
							invoke: {
								src: 'read',
								input: ({ context, self }) => ({
									capability: required(context.capability).read,
									id: context.readerId,
									generation: context.readerGeneration,
									reportTo: self
								}),
								onError: { target: 'shown', actions: assign({ reader: { kind: 'unavailable' } }) }
							}
						},
						shown: {
							meta: {
								readerMessage: ({ reader }) => ({
									text: t(
										reader?.kind === 'available' ? 'capture.text_only' : 'reader.unavailable'
									),
									variant: reader?.kind === 'available' ? 'info' : 'error'
								})
							}
						}
					}
				}
			}
		},
		closed: {
			type: 'final',
			entry: assign({
				capability: undefined,
				reader: undefined,
				rows: [],
				sync: {},
				background: {},
				url: '',
				captureId: '',
				failure: ''
			})
		}
	}
})
export function selectLibraryView(
	snapshot: SnapshotFrom<typeof libraryMachine> | undefined,
	_gatewayEnabled = true
) {
	const c = snapshot?.context
	const visible = !!c && !c.closing && snapshot.status === 'active'
	const meta = visible ? Object.values(snapshot.getMeta()) : []
	const rowMessages: Record<string, WorkflowMessage> = {}
	if (visible)
		for (const row of c.rows) {
			if (!row.contentId || c.background[row.id]) {
				if (row.failure) rowMessages[row.id] = failureMessage(row.failure)
				else if (c.background[row.id]) rowMessages[row.id] = required(c.background[row.id])
			}
		}
	return {
		captureMessage: visible
			? c.failure === 'captureFailed'
				? failureMessage(c.failure)
				: meta.find((m) => m?.captureMessage)?.captureMessage?.(c)
			: undefined,
		readerMessage: !snapshot
			? { text: t('reader.loading'), variant: 'info' as const }
			: visible
				? meta.find((m) => m?.readerMessage)?.readerMessage?.(c)
				: undefined,
		listMessage:
			visible && c.listFailed
				? { text: t('library.list_failed'), variant: 'error' as const }
				: undefined,
		emptyMessage:
			visible && !c.rows.length
				? { text: t('library.empty'), variant: 'info' as const }
				: undefined,
		syncMessages: visible
			? Object.fromEntries(
					Object.entries(c.sync)
						.filter(([id]) => !c.background[id])
						.map(([id, status]) => [id, syncMessage(status)])
				)
			: {},
		rowMessages,
		readable: visible
			? Object.fromEntries(c.rows.map((row) => [row.id, !!row.contentId && !c.background[row.id]]))
			: {},
		canOpenCapture: visible && c.captureReady && !c.background[c.captureId],
		canCancel: visible && snapshot.can({ type: 'CANCEL' }) && (c.writing || c.backgroundCancelable)
	}
}
