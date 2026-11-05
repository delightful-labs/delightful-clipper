import {
	assign,
	enqueueActions,
	fromCallback,
	sendTo,
	setup,
	stopChild,
	raise,
	stateIn,
	and,
	not
} from 'xstate'
import type { SnapshotFrom } from 'xstate'
import {
	canRequestOrganization,
	libraryViews,
	matchesLibraryFilter
} from '../../capture/organization.js'
import type { OrganizationRequest, LibraryView } from '../../capture/organization.js'
import { t } from '../../localization/index.js'
import { normalizedSource } from '../../capture/source.js'
import type { WorkflowMessage } from '../../contracts/feedback.js'
import type { LibraryCapability, LibraryEvent, SaveRef } from '../../contracts/library.js'
import type { ArticleSaveResult, LibraryArticle, ArticleContent } from '../../contracts/articles.js'
import type { QueueControl } from '../../contracts/article-worker.js'
import type { ReadResult } from '../../contracts/storage.js'
import { syncOwnerMachine } from '../storage/sync-owner.js'
import { readRecordMachine } from '../storage/read.js'
function required<T>(v: T | undefined): T {
	if (v === undefined) throw new Error('Library unavailable')
	return v
}
function savedResult(result: ArticleSaveResult) {
	if (result.kind !== 'saved' && result.kind !== 'duplicate')
		throw new Error('Expected locally saved result')
	return result
}
type Context = {
	organizationRef: SaveRef | undefined
	organizationRequest: OrganizationRequest | undefined
	organizationId: string
	organizationOperations: Record<string, string>
	view: LibraryView
	favorites: boolean
	capability: LibraryCapability | undefined
	saveRef: SaveRef | undefined
	url: string
	content: ArticleContent | undefined
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
function hasWatchableReceipts(result: ArticleSaveResult) {
	if (result.kind !== 'saved' && result.kind !== 'duplicate') return false
	return result.receipts.length > 0
}
function shouldReopenReader(context: Context, rows: LibraryArticle[]) {
	if (!context.readerId) return false
	if (context.reader?.kind === 'available') return false
	return rows.some((row) => row.id === context.readerId && !!row.contentId)
}
function isValidSourceUrl(url: string) {
	try {
		normalizedSource(url)
		return true
	} catch {
		return false
	}
}
type Meta = {
	organizationMessage?: (c: Context) => WorkflowMessage
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
function organizationSyncMessage(context: Context, articleId: string): WorkflowMessage | undefined {
	const statuses = Object.entries(context.organizationOperations)
		.filter(([, id]) => id === articleId)
		.map(([operationId]) => context.sync[operationId])
	if (statuses.includes('rejected')) return syncMessage('rejected')
	if (statuses.includes('pending')) return syncMessage('pending')
	if (statuses.includes('accepted')) return syncMessage('accepted')
	return undefined
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
	| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
	| { type: `xstate.done.actor.${string}`; actorId: string; output: ArticleSaveResult }
	| { type: `xstate.error.actor.${string}`; actorId: string; error: unknown },
	typeof actors,
	{},
	{ close: undefined; watch: undefined; updateRows: undefined },
	{
		canUseLibrary: undefined
		canStartSave: undefined
		accepting: undefined
		writing: undefined
		closing: undefined
		drained: undefined
		organizing: undefined
	},
	never,
	string,
	LibraryCapability | undefined,
	undefined,
	{ type: string },
	Meta
>({
	actors,
	guards: {
		accepting: stateIn({ running: { control: 'active' } }),
		closing: stateIn({ running: { control: 'closing' } }),
		writing: stateIn({ running: { capture: 'saving' } }),
		organizing: stateIn({ running: { organization: 'writing' } }),
		canUseLibrary: and(['accepting', ({ context }) => !!context.capability?.isCurrent()]),
		canStartSave: and(['canUseLibrary', not('writing')]),
		drained: and([
			'closing',
			not('writing'),
			not('organizing'),
			stateIn({ running: { workerLifecycle: 'closed' } })
		])
	},
	actions: {
		close: enqueueActions(({ enqueue }) => {
			enqueue.sendTo('worker', { type: 'STOP' })
			enqueue.sendTo('receipts', { type: 'SHUTDOWN' })
			enqueue.assign({
				reader: undefined,
				rows: [],
				url: '',
				content: undefined,
				sync: {},
				background: {},
				backgroundCancelable: false
			})
		}),
		watch: raise(({ event }) => {
			const result =
				event.type === 'BACKGROUND_SAVED'
					? event.result
					: 'output' in event
						? event.output
						: undefined
			return { type: 'WATCH_RECEIPTS', result: required(result) }
		}),
		updateRows: assign(({ context, event }) => {
			if (event.type !== 'ROWS') throw new Error('Expected collection rows')
			return {
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
			}
		})
	}
}).createMachine({
	id: 'library',
	initial: 'running',
	context: ({ input }) => ({
		capability: input,
		organizationRef: undefined,
		organizationRequest: undefined,
		organizationId: '',
		organizationOperations: {},
		view: 'all',
		favorites: false,
		saveRef: undefined,
		url: '',
		content: undefined,
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
				guard: 'drained',
				target: 'closed'
			},
			on: {
				FILTER: {
					guard: and([
						'canUseLibrary',
						({ event }) => libraryViews.includes(event.view) && typeof event.favorites === 'boolean'
					]),
					actions: assign({
						view: ({ event }) => event.view,
						favorites: ({ event }) => event.favorites
					})
				},
				WATCH_RECEIPTS: {
					guard: and(['canUseLibrary', ({ event }) => hasWatchableReceipts(event.result)]),
					actions: [
						assign({
							sync: ({ context, event }) => ({
								...context.sync,
								[event.result.operationId]: 'pending'
							})
						}),
						sendTo('receipts', ({ event }) => ({
							type: 'WATCH',
							id: event.result.operationId,
							receipts: savedResult(event.result).receipts
						}))
					]
				},
				ROWS: [
					{
						guard: and([
							'canUseLibrary',
							({ context, event }) => shouldReopenReader(context, event.rows)
						]),
						actions: [
							'updateRows',
							raise(({ context }) => ({ type: 'OPEN', id: context.readerId }))
						]
					},
					{
						guard: 'canUseLibrary',
						actions: 'updateRows'
					}
				],
				LIST_FAILED: { actions: assign({ listFailed: true }) },
				BACKGROUND_ERROR: {
					guard: 'accepting',
					actions: assign({ failure: 'captureFailed' })
				},
				BACKGROUND_STATUS: {
					guard: 'canUseLibrary',
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
					guard: 'canUseLibrary',
					actions: [
						'watch',
						assign({
							background: ({ context, event }) =>
								Object.fromEntries(
									Object.entries(context.background).filter(
										([id]) =>
											!(
												id === event.result.operationId &&
												'ready' in event.result &&
												event.result.ready
											)
									)
								),
							captureReady: ({ context, event }) =>
								context.captureReady ||
								(event.result.operationId === context.captureId &&
									'ready' in event.result &&
									event.result.ready === true)
						})
					]
				},
				RETRY: {
					guard: 'accepting',
					actions: sendTo('worker', ({ event }) => ({ type: 'RETRY', id: event.id }))
				},
				SYNC: {
					guard: 'canUseLibrary',
					actions: assign({
						sync: ({ context, event }) => ({ ...context.sync, [event.id]: event.status })
					})
				}
			},
			states: {
				organization: {
					initial: 'idle',
					on: {
						ORGANIZE: {
							guard: and([
								'canUseLibrary',
								not('organizing'),
								({ context, event }) =>
									!!context.capability?.spawnOrganization &&
									canRequestOrganization(context.rows, event.request)
							]),
							target: '.writing',
							actions: assign({
								organizationRequest: ({ event }) => ({ ...event.request }),
								organizationId: ({ event }) => event.request.id
							})
						}
					},
					states: {
						idle: {},
						writing: {
							meta: {
								organizationMessage: () => ({ text: t('capture.status.saving'), variant: 'info' })
							},
							initial: 'active',
							entry: assign(({ context, spawn }) => ({
								organizationRef: required(required(context.capability).spawnOrganization)(
									(logic, options) => spawn(logic, options),
									required(context.organizationRequest)
								)
							})),
							exit: [
								stopChild(({ context }) => required(context.organizationRef)),
								assign({ organizationRef: undefined, organizationRequest: undefined })
							],
							states: {
								active: {
									on: {
										SHUTDOWN: {
											target: 'stopping',
											actions: sendTo(({ context }) => required(context.organizationRef), {
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
										guard: and([
											'closing',
											({ context, event }) => event.actorId === context.organizationRef?.id
										]),
										target: 'idle'
									},
									{
										guard: ({ context, event }) =>
											event.actorId === context.organizationRef?.id &&
											event.output.kind === 'saved',
										target: 'saved',
										actions: [
											'watch',
											assign({
												organizationOperations: ({ context, event }) => ({
													...context.organizationOperations,
													[event.output.operationId]: context.organizationId
												})
											})
										]
									},
									{
										guard: ({ context, event }) =>
											event.actorId === context.organizationRef?.id &&
											event.output.kind === 'unknown',
										target: 'unknown'
									},
									{
										guard: ({ context, event }) => event.actorId === context.organizationRef?.id,
										target: 'failed'
									}
								],
								'xstate.error.actor.*': {
									guard: ({ context, event }) => event.actorId === context.organizationRef?.id,
									target: 'unknown'
								}
							}
						},
						saved: {
							meta: {
								organizationMessage: (c) =>
									organizationSyncMessage(c, c.organizationId) ?? {
										text: t('capture.status.saved'),
										variant: 'info'
									}
							}
						},
						unknown: {
							meta: {
								organizationMessage: () => ({ text: t('capture.status.unknown'), variant: 'error' })
							}
						},
						failed: {
							meta: {
								organizationMessage: () => ({
									text: t('capture.status.save_failed'),
									variant: 'error'
								})
							}
						}
					}
				},
				control: {
					initial: 'active',
					states: {
						active: { on: { SHUTDOWN: { target: 'closing', actions: 'close' } } },
						closing: {}
					}
				},
				workerLifecycle: {
					initial: 'active',
					states: { active: { on: { BACKGROUND_CLOSED: 'closed' } }, closed: {} }
				},
				capture: {
					initial: 'idle',
					on: {
						ADD: [
							{
								guard: and(['canStartSave', ({ event }) => isValidSourceUrl(event.url)]),
								target: '.saving',
								actions: assign({
									url: ({ event }) => event.url,
									content: ({ event }) => event.content,
									failure: '',
									captureReady: false
								})
							},
							{
								guard: and(['accepting', not('writing')]),
								target: '.failed',
								actions: assign({ failure: 'invalidUrl' })
							}
						],
						CANCEL: {
							guard: and([
								not('writing'),
								'accepting',
								({ context }) => context.backgroundCancelable
							]),
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
								saveRef: required(context.capability).spawnSave(
									(logic, options) => spawn(logic, options),
									{ url: context.url, ...(context.content ? { content: context.content } : {}) }
								)
							})),
							exit: [
								stopChild(({ context }) => required(context.saveRef)),
								assign({ saveRef: undefined, content: undefined })
							],
							states: {
								active: {
									on: {
										SHUTDOWN: {
											target: 'stopping',
											actions: sendTo(({ context }) => required(context.saveRef), {
												type: 'SHUTDOWN'
											})
										},
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
										guard: and([
											'closing',
											({ context, event }) => event.actorId === context.saveRef?.id
										]),
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
							guard: 'canUseLibrary',
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
							guard: and([
								'canUseLibrary',
								({ context, event }) => event.generation === context.readerGeneration
							]),
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
				organizationRef: undefined,
				organizationRequest: undefined,
				organizationId: '',
				organizationOperations: {},
				reader: undefined,
				rows: [],
				sync: {},
				background: {},
				url: '',
				content: undefined,
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
	const visible =
		!!c &&
		snapshot.matches({ running: { control: 'active' } }) &&
		snapshot.status === 'active' &&
		!!c.capability?.isCurrent()
	const meta = visible ? Object.values(snapshot.getMeta()) : []
	const rowMessages: Record<string, WorkflowMessage> = {}
	if (visible)
		for (const row of c.rows) {
			if (!row.contentId || c.background[row.id]) {
				if (row.failure) rowMessages[row.id] = failureMessage(row.failure)
				else if (c.background[row.id]) rowMessages[row.id] = required(c.background[row.id])
			}
		}
	const rows = visible ? c.rows.filter((row) => matchesLibraryFilter(row, c.view, c.favorites)) : []
	return {
		rows,
		organizationMessage: visible
			? meta.find((m) => m?.organizationMessage)?.organizationMessage?.(c)
			: undefined,
		canOrganize:
			visible &&
			!!c.capability?.spawnOrganization &&
			!snapshot.matches({ running: { organization: 'writing' } }),
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
			visible && !rows.length
				? {
						text: t(c.rows.length ? 'library.filtered_empty' : 'library.empty'),
						variant: 'info' as const
					}
				: undefined,
		syncMessages: visible
			? Object.fromEntries(
					Object.entries(c.sync)
						.filter(([id]) => !c.background[id])
						.map(([id, status]) => [id, syncMessage(status)])
				)
			: {},
		organizationMessages: visible
			? Object.fromEntries(
					c.rows.flatMap((row) => {
						const message = organizationSyncMessage(c, row.id)
						return message ? [[row.id, message]] : []
					})
				)
			: {},
		rowMessages,
		readable: visible ? Object.fromEntries(c.rows.map((row) => [row.id, !!row.contentId])) : {},
		canOpenCapture: visible && c.captureReady && !c.background[c.captureId],
		canCancel:
			visible &&
			snapshot.can({ type: 'CANCEL' }) &&
			(snapshot.matches({ running: { capture: 'saving' } }) || c.backgroundCancelable)
	}
}
