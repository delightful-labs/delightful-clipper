import type { EventPayload } from '../events.js'
import { types, createCallbackLogic, setup, matchesState, type SnapshotFrom } from 'xstate'
import { imageQueueMachine } from '../../images/queue-machine.js'
import { readerExperienceMachine, selectReaderExperience } from '../reader/experience.js'
import type { FakeDataOutcome } from '../../samples/machine.js'

import {
	canRequestOrganization,
	libraryViews,
	matchesLibraryFilter
} from '../../capture/organization.js'
import type { OrganizationRequest, LibraryView } from '../../capture/organization.js'
import { z } from 'zod'
import { createSearchMachine, selectSearchView } from '../../search/machine.js'
import { querySchema } from '../../search/schema.js'
import { matchesTags } from '../../capture/tags.js'
import { t } from '../../localization/index.js'
import { normalizedSource } from '../../capture/source.js'
import { stateFeedback } from '../../contracts/feedback.js'
import type { WorkflowMessage } from '../../contracts/feedback.js'
import type {
	LibraryCapability,
	LibraryEvent,
	SaveRef,
	FakeDataRef
} from '../../contracts/library.js'
import type { ArticleSaveResult, LibraryArticle, ArticleContent } from '../../contracts/articles.js'
import type { QueueControl } from '../../contracts/article-worker.js'
import type { ReadResult } from '../../contracts/storage.js'
import { syncOwnerMachine } from '../storage/sync-owner.js'
import { readRecordMachine } from '../storage/read.js'
function required<T>(v: T | undefined): T {
	if (v === undefined) throw new Error('Library unavailable')
	return v
}
function saveOutcome(result: ArticleSaveResult | FakeDataOutcome): ArticleSaveResult {
	if (typeof result === 'string') throw new Error('Expected article write outcome')
	return result
}
function savedResult(value: ArticleSaveResult | FakeDataOutcome) {
	const result = saveOutcome(value)
	if (result.kind !== 'saved' && result.kind !== 'duplicate')
		throw new Error('Expected locally saved result')
	return result
}
type Context = {
	fakeDataRef: FakeDataRef | undefined
	organizationRef: SaveRef | undefined
	organizationRequest: OrganizationRequest | undefined
	organizationId: string
	organizationOperations: Record<string, string>
	view: LibraryView
	favorites: boolean
	selectedTags: string[]
	query: string
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
	channel?: string
	name?: string
	variant?: WorkflowMessage['variant']
	priority?: number
	message?: (c: Context) => WorkflowMessage
}
function organizationStatuses(context: Context, articleId: string) {
	return Object.entries(context.organizationOperations)
		.filter(([, id]) => id === articleId)
		.map(([operationId]) => context.sync[operationId])
}
const actors = {
	readerExperience: readerExperienceMachine,
	images: imageQueueMachine,
	search: createSearchMachine(),
	collection: createCallbackLogic<LibraryEvent, LibraryCapability | undefined>(
		({ input, sendBack }) => {
			try {
				return input?.subscribe(
					(rows) => sendBack({ type: 'ROWS', rows }),
					() => sendBack({ type: 'LIST_FAILED' })
				)
			} catch {
				sendBack({ type: 'LIST_FAILED' })
				return
			}
		}
	),
	worker: createCallbackLogic<QueueControl, LibraryCapability | undefined>(
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
export const libraryMachine = setup({
	schemas: {
		context: types<Context>(),
		events: {
			WRITE_DONE: types<{ actorId: string; output: ArticleSaveResult | FakeDataOutcome }>(),
			WRITE_ERROR: types<{ actorId: string; error: unknown }>(),
			RETRY_IMAGE: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'RETRY_IMAGE'
				>
			>(),
			IMAGE_ERROR: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'IMAGE_ERROR'
				>
			>(),
			READER_EVENT: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'READER_EVENT'
				>
			>(),
			ORGANIZE: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'ORGANIZE'
				>
			>(),
			FILTER: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'FILTER'
				>
			>(),
			TAG_FILTER: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'TAG_FILTER'
				>
			>(),
			QUERY: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'QUERY'
				>
			>(),
			RETRY_SEARCH: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'RETRY_SEARCH'
				>
			>(),
			SEARCH_OPEN: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'SEARCH_OPEN'
				>
			>(),
			READ_RESULT: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'READ_RESULT'
				>
			>(),
			SYNC: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'SYNC'
				>
			>(),
			BACKGROUND_STATUS: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'BACKGROUND_STATUS'
				>
			>(),
			BACKGROUND_SAVED: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'BACKGROUND_SAVED'
				>
			>(),
			BACKGROUND_CLOSED: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'BACKGROUND_CLOSED'
				>
			>(),
			BACKGROUND_ERROR: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'BACKGROUND_ERROR'
				>
			>(),
			ADD: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'ADD'
				>
			>(),
			CANCEL: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'CANCEL'
				>
			>(),
			SHUTDOWN: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'SHUTDOWN'
				>
			>(),
			CLOSE_READER: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'CLOSE_READER'
				>
			>(),
			OPEN: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'OPEN'
				>
			>(),
			RETRY: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'RETRY'
				>
			>(),
			ROWS: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'ROWS'
				>
			>(),
			LIST_FAILED: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'LIST_FAILED'
				>
			>(),
			CAPTURE_UPDATED: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'CAPTURE_UPDATED'
				>
			>(),
			CAPTURE_SAVED: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'CAPTURE_SAVED'
				>
			>(),
			WATCH_RECEIPTS: types<
				EventPayload<
					| LibraryEvent
					| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
					| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
					| {
							type: 'WRITE_DONE'
							actorId: string
							output: ArticleSaveResult | FakeDataOutcome
					  }
					| { type: 'WRITE_ERROR'; actorId: string; error: unknown },
					'WATCH_RECEIPTS'
				>
			>()
		},
		input: types<LibraryCapability | undefined>(),
		output: types<undefined>(),
		meta: types<Meta>(),
		tags: types<string>(),
		children: {
			readerExperience: types<import('xstate').ActorRefFrom<(typeof actors)['readerExperience']>>(),
			images: types<import('xstate').ActorRefFrom<(typeof actors)['images']>>(),
			search: types<import('xstate').ActorRefFrom<(typeof actors)['search']>>(),
			collection: types<import('xstate').ActorRefFrom<(typeof actors)['collection']>>(),
			worker: types<import('xstate').ActorRefFrom<(typeof actors)['worker']>>(),
			receipts: types<import('xstate').ActorRefFrom<(typeof actors)['receipts']>>(),
			read: types<import('xstate').ActorRefFrom<(typeof actors)['read']>>()
		}
	},
	actors,
	guards: {
		isReaderAvailable: ({ context }: { context: Context }) => context.reader?.kind === 'available',
		isOrganizationRejected: ({ context }: { context: Context }) =>
			organizationStatuses(context, context.organizationId).includes('rejected'),
		isOrganizationPending: ({ context }: { context: Context }) =>
			organizationStatuses(context, context.organizationId).includes('pending'),
		isOrganizationSynced: ({ context }: { context: Context }) =>
			organizationStatuses(context, context.organizationId).includes('accepted'),
		hasCaptureBackground: ({ context }: { context: Context }) =>
			!!context.background[context.captureId],
		isDuplicateCapture: ({ context }: { context: Context }) => context.failure === 'duplicate',
		isCaptureSynced: ({ context }: { context: Context }) =>
			context.sync[context.captureId] === 'accepted',
		isCaptureRejected: ({ context }: { context: Context }) =>
			context.sync[context.captureId] === 'rejected',
		accepting: ({ value }: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'active' } }, value),
		closing: ({ value }: { value: import('xstate').StateValue }) =>
			matchesState({ running: { control: 'closing' } }, value),
		writing: ({ value }: { value: import('xstate').StateValue }) =>
			matchesState({ running: { capture: 'saving' } }, value),
		organizing: ({ value }: { value: import('xstate').StateValue }) =>
			matchesState({ running: { organization: 'writing' } }, value),
		readInFlight: ({ value }: { value: import('xstate').StateValue }) =>
			matchesState({ running: { reading: 'loading' } }, value)
	},
	actions: {
		updateRows: ({
			context,
			event
		}: {
			context: Context
			event:
				| LibraryEvent
				| { type: 'CAPTURE_UPDATED' | 'CAPTURE_SAVED' }
				| { type: 'WATCH_RECEIPTS'; result: ArticleSaveResult }
				| {
						type: 'WRITE_DONE'
						actorId: string
						output: ArticleSaveResult | FakeDataOutcome
				  }
				| { type: 'WRITE_ERROR'; actorId: string; error: unknown }
		}) => {
			if (event.type !== 'ROWS') throw new Error('Expected collection rows')
			return {
				context: {
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
			}
		}
	}
}).createMachine({
	id: 'library',
	initial: 'running',
	context: ({ input }) => ({
		capability: input,
		fakeDataRef: undefined,
		organizationRef: undefined,
		organizationRequest: undefined,
		organizationId: '',
		organizationOperations: {},
		view: 'all',
		favorites: false,
		selectedTags: [],
		query: '',
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
				{
					id: 'collection',
					src: 'collection',
					input: ({ context }: { context: Context }) => context.capability
				},
				{
					id: 'search',
					src: 'search',
					input: ({ context }: { context: Context }) => ({
						capability: context.capability?.search
					}),
					onSnapshot: {}
				},
				{
					id: 'worker',
					src: 'worker',
					input: ({ context }: { context: Context }) => context.capability
				},
				{ id: 'receipts', src: 'receipts', input: ({ self }) => ({ reportTo: self }) }
			],
			always: (args) => {
				if (
					!(
						matchesState({ running: { control: 'closing' } }, args.value) &&
						matchesState({ running: { fakeDataLifecycle: 'closed' } }, args.value) &&
						(matchesState({ running: { imageLifecycle: 'closed' } }, args.value) ||
							matchesState({ running: { imageLifecycle: 'failed' } }, args.value)) &&
						(matchesState({ running: { readerLifecycle: 'closed' } }, args.value) ||
							matchesState({ running: { readerLifecycle: 'failed' } }, args.value)) &&
						!matchesState({ running: { capture: 'saving' } }, args.value) &&
						!matchesState({ running: { organization: 'writing' } }, args.value) &&
						(matchesState({ running: { workerLifecycle: 'closed' } }, args.value) ||
							matchesState({ running: { workerLifecycle: { failed: 'closed' } } }, args.value))
					)
				)
					return
				return { target: 'closed' }
			},
			on: {
				READER_EVENT: (args, enq) => {
					const { context, event } = args
					if (
						matchesState({ running: { control: 'active' } }, args.value) &&
						!!context.capability?.isCurrent() &&
						matchesState({ running: { readerLifecycle: 'active' } }, args.value) &&
						matchesState({ running: { imageLifecycle: 'active' } }, args.value)
					) {
						enq.sendTo('readerExperience', event.event)
						enq.sendTo('images', event.event)
						return {}
					}
					if (
						matchesState({ running: { control: 'active' } }, args.value) &&
						!!context.capability?.isCurrent() &&
						matchesState({ running: { readerLifecycle: 'active' } }, args.value)
					) {
						enq.sendTo('readerExperience', event.event)
						return {}
					}
					if (event.event.type === 'ATTACH_SURFACE')
						enq(() => {
							if (event.event.type === 'ATTACH_SURFACE') event.event.surface.lifecycle?.released()
						})
				},

				QUERY: (args, enq) => {
					const { context, event } = args
					if (
						!(
							matchesState({ running: { control: 'active' } }, args.value) &&
							!!context.capability?.isCurrent() &&
							!!context.capability?.search &&
							querySchema.safeParse(event.query).success
						)
					)
						return
					enq.sendTo('search', { type: 'QUERY', query: event.query })
					return { context: { query: event.query } }
				},
				SEARCH_OPEN: (args, enq) => {
					if (
						!(
							matchesState({ running: { control: 'active' } }, args.value) &&
							!!args.context.capability?.isCurrent()
						)
					)
						return
					enq.sendTo('search', { type: 'ACTIVATE' })
				},
				RETRY_SEARCH: (args, enq) => {
					if (
						!(
							matchesState({ running: { control: 'active' } }, args.value) &&
							!!args.context.capability?.isCurrent()
						)
					)
						return
					enq.sendTo('search', { type: 'RETRY' })
				},
				TAG_FILTER: (args) => {
					const { event } = args
					if (
						!(
							matchesState({ running: { control: 'active' } }, args.value) &&
							!!args.context.capability?.isCurrent() &&
							z.array(z.string().min(1).max(512)).max(64).safeParse(event.keys).success
						)
					)
						return
					return { context: { selectedTags: [...new Set(event.keys)] } }
				},
				FILTER: (args) => {
					const { event } = args
					if (
						!(
							matchesState({ running: { control: 'active' } }, args.value) &&
							!!args.context.capability?.isCurrent() &&
							libraryViews.includes(event.view) &&
							typeof event.favorites === 'boolean'
						)
					)
						return
					return { context: { view: event.view, favorites: event.favorites } }
				},
				WATCH_RECEIPTS: (args, enq) => {
					const { context, event } = args
					if (
						!(
							matchesState({ running: { control: 'active' } }, args.value) &&
							!!context.capability?.isCurrent() &&
							hasWatchableReceipts(event.result)
						)
					)
						return
					enq.sendTo('receipts', {
						type: 'WATCH',
						id: event.result.operationId,
						receipts: savedResult(event.result).receipts
					})
					enq.raise({ type: 'CAPTURE_UPDATED' })
					return {
						context: {
							sync: {
								...context.sync,
								[event.result.operationId]: 'pending'
							}
						}
					}
				},
				ROWS: (args, enq) => {
					const { context } = args
					if (
						matchesState({ running: { control: 'active' } }, args.value) &&
						!!context.capability?.isCurrent() &&
						!matchesState({ running: { reading: 'loading' } }, args.value) &&
						shouldReopenReader(context, args.event.rows)
					) {
						let context = args.context
						let patch = {}
						patch = { ...patch, ...args.actions.updateRows(args).context }
						context = { ...args.context, ...patch }
						enq.sendTo('search', { type: 'ROWS', rows: context.rows })
						enq.raise({ type: 'CAPTURE_UPDATED' })
						enq.raise({ type: 'OPEN', id: context.readerId })
						return { context: patch }
					}
					if (
						matchesState({ running: { control: 'active' } }, args.value) &&
						!!context.capability?.isCurrent()
					) {
						let context = args.context
						let patch = {}
						patch = { ...patch, ...args.actions.updateRows(args).context }
						context = { ...args.context, ...patch }
						enq.sendTo('search', { type: 'ROWS', rows: context.rows })
						enq.raise({ type: 'CAPTURE_UPDATED' })
						return { context: patch }
					}
				},
				LIST_FAILED: () => {
					return { context: { listFailed: true } }
				},
				BACKGROUND_STATUS: (args, enq) => {
					const { context, event } = args
					if (
						!(
							matchesState({ running: { control: 'active' } }, args.value) &&
							!!context.capability?.isCurrent()
						)
					)
						return
					enq.raise({ type: 'CAPTURE_UPDATED' })
					return {
						context: {
							backgroundId: event.id,
							backgroundCancelable: event.cancelable,
							background: {
								...context.background,
								[event.id]: event.message
							}
						}
					}
				},
				BACKGROUND_SAVED: (args, enq) => {
					const { context, event } = args
					if (
						!(
							matchesState({ running: { control: 'active' } }, args.value) &&
							!!context.capability?.isCurrent()
						)
					)
						return
					enq.raise({ type: 'WATCH_RECEIPTS', result: saveOutcome(args.event.result) })
					enq.raise({ type: 'CAPTURE_UPDATED' })
					return {
						context: {
							background: Object.fromEntries(
								Object.entries(context.background).filter(
									([id]) =>
										!(
											id === event.result.operationId &&
											'ready' in event.result &&
											event.result.ready
										)
								)
							),
							captureReady:
								context.captureReady ||
								(event.result.operationId === context.captureId &&
									'ready' in event.result &&
									event.result.ready === true)
						}
					}
				},
				RETRY: (args, enq) => {
					if (!matchesState({ running: { control: 'active' } }, args.value)) return
					enq.sendTo('worker', { type: 'RETRY', id: args.event.id })
				},
				SYNC: (args, enq) => {
					const { context, event } = args
					if (
						!(
							matchesState({ running: { control: 'active' } }, args.value) &&
							!!context.capability?.isCurrent()
						)
					)
						return
					enq.raise({ type: 'CAPTURE_UPDATED' })
					return { context: { sync: { ...context.sync, [event.id]: event.status } } }
				}
			},
			states: {
				imageLifecycle: {
					initial: 'active',
					states: {
						active: {
							invoke: {
								id: 'images',
								src: 'images',
								input: ({ context }: { context: Context }) => ({
									capability: context.capability?.images
								}),
								onSnapshot: {},
								onDone: { target: 'closed' },
								onError: { target: 'failed' }
							},
							on: {
								SHUTDOWN: (args, enq) => {
									enq.sendTo('images', { type: 'SHUTDOWN' })
								},
								CLOSE_READER: (args, enq) => {
									enq.sendTo('images', { type: 'DETACH' })
								},
								IMAGE_ERROR: (args, enq) => {
									if (
										!(
											matchesState({ running: { control: 'active' } }, args.value) &&
											!!args.context.capability?.isCurrent()
										)
									)
										return
									const { event } = args
									enq.sendTo('images', {
										type: 'IMAGE_ERROR',
										id: event.id,
										url: event.url
									})
								},
								RETRY_IMAGE: (args, enq) => {
									if (
										!(
											matchesState({ running: { control: 'active' } }, args.value) &&
											!!args.context.capability?.isCurrent()
										)
									)
										return
									enq.sendTo('images', { type: 'RETRY', id: args.event.id })
								}
							}
						},
						closed: {},
						failed: {}
					}
				},
				readerLifecycle: {
					initial: 'active',
					states: {
						active: {
							invoke: {
								id: 'readerExperience',
								src: 'readerExperience',
								input: ({ context }: { context: Context }) => ({
									capability: context.capability?.reader
								}),
								onSnapshot: {},
								onDone: { target: 'closed' },
								onError: { target: 'failed' }
							},
							on: {
								CLOSE_READER: (args, enq) => {
									enq.sendTo('readerExperience', { type: 'SHOW_CONTROLS' })
								},
								SHUTDOWN: (args, enq) => {
									enq.sendTo('readerExperience', { type: 'SHUTDOWN' })
								}
							}
						},
						closed: {},
						failed: {
							meta: {
								channel: 'reader',
								name: t('reader.data_unavailable'),
								variant: 'error'
							}
						}
					}
				},
				fakeDataLifecycle: {
					initial: 'checking',
					states: {
						checking: {
							type: 'choice',
							choice: (args) => {
								if (args.context.capability?.spawnFakeData) {
									return { target: 'active' }
								}
								return { target: 'closed' }
							}
						},
						active: {
							entry: (args, enq) => {
								return {
									context: {
										fakeDataRef: (({ context, spawn }) =>
											(() => {
												const ref = required(context.capability?.spawnFakeData)(spawn)
												enq.subscribeTo(ref, {
													done: (
														output
													):
														| {
																type: 'WRITE_DONE'
																actorId: string
																output: ArticleSaveResult | FakeDataOutcome
														  }
														| { type: 'WRITE_ERROR'; actorId: string; error: unknown } => ({
														type: 'WRITE_DONE',
														actorId: ref.id,
														output
													}),
													error: (
														error
													):
														| {
																type: 'WRITE_DONE'
																actorId: string
																output: ArticleSaveResult | FakeDataOutcome
														  }
														| { type: 'WRITE_ERROR'; actorId: string; error: unknown } => ({
														type: 'WRITE_ERROR',
														actorId: ref.id,
														error
													})
												})
												return ref
											})())({ ...args, spawn: enq.spawn })
									}
								}
							},
							on: {
								WRITE_DONE: (args) => {
									if (!(args.event.actorId === args.context.fakeDataRef?.id)) return
									return { target: 'closed' }
								},
								WRITE_ERROR: (args) => {
									if (!(args.event.actorId === args.context.fakeDataRef?.id)) return
									return { target: 'closed' }
								},
								SHUTDOWN: (args, enq) => {
									enq.sendTo(required(args.context.fakeDataRef), {
										type: 'SHUTDOWN'
									})
								}
							}
						},
						closed: {}
					}
				},
				organization: {
					initial: 'idle',
					on: {
						ORGANIZE: (args) => {
							const { context, event } = args
							if (
								!(
									matchesState({ running: { control: 'active' } }, args.value) &&
									!!context.capability?.isCurrent() &&
									!matchesState({ running: { organization: 'writing' } }, args.value) &&
									!!context.capability?.spawnOrganization &&
									canRequestOrganization(context.rows, event.request)
								)
							)
								return
							return {
								target: '.writing',
								context: {
									organizationRequest: { ...event.request },
									organizationId: event.request.id
								}
							}
						}
					},
					states: {
						idle: {},
						writing: {
							meta: {
								channel: 'organization',
								name: t('capture.status.saving'),
								variant: 'info'
							},
							initial: 'active',
							entry: (args, enq) => {
								return {
									context: (({ context, spawn }) => ({
										organizationRef: (() => {
											const ref = required(required(context.capability).spawnOrganization)(
												spawn,
												required(context.organizationRequest)
											)
											enq.subscribeTo(ref, {
												done: (
													output
												):
													| {
															type: 'WRITE_DONE'
															actorId: string
															output: ArticleSaveResult | FakeDataOutcome
													  }
													| { type: 'WRITE_ERROR'; actorId: string; error: unknown } => ({
													type: 'WRITE_DONE',
													actorId: ref.id,
													output
												}),
												error: (
													error
												):
													| {
															type: 'WRITE_DONE'
															actorId: string
															output: ArticleSaveResult | FakeDataOutcome
													  }
													| { type: 'WRITE_ERROR'; actorId: string; error: unknown } => ({
													type: 'WRITE_ERROR',
													actorId: ref.id,
													error
												})
											})
											return ref
										})()
									}))({ ...args, spawn: enq.spawn })
								}
							},
							exit: (args, enq) => {
								enq.stop(required(args.context.organizationRef))
								return { context: { organizationRef: undefined, organizationRequest: undefined } }
							},
							states: {
								active: {
									on: {
										SHUTDOWN: (args, enq) => {
											enq.sendTo(required(args.context.organizationRef), {
												type: 'SHUTDOWN'
											})
											return { target: 'stopping' }
										}
									}
								},
								stopping: {}
							},
							on: {
								WRITE_DONE: (args, enq) => {
									const { context, event } = args
									if (
										matchesState({ running: { control: 'closing' } }, args.value) &&
										event.actorId === context.organizationRef?.id
									) {
										return { target: 'idle' }
									}
									if (
										event.actorId === context.organizationRef?.id &&
										saveOutcome(event.output).kind === 'saved'
									) {
										enq.raise({ type: 'WATCH_RECEIPTS', result: saveOutcome(args.event.output) })
										return {
											target: 'saved',
											context: {
												organizationOperations: {
													...context.organizationOperations,
													[saveOutcome(event.output).operationId]: context.organizationId
												}
											}
										}
									}
									if (
										event.actorId === context.organizationRef?.id &&
										saveOutcome(event.output).kind === 'unknown'
									) {
										return { target: 'unknown' }
									}
									if (event.actorId === context.organizationRef?.id) {
										return { target: 'failed' }
									}
								},
								WRITE_ERROR: (args) => {
									if (!(args.event.actorId === args.context.organizationRef?.id)) return
									return { target: 'unknown' }
								}
							}
						},
						saved: {
							initial: 'deciding',
							on: { CAPTURE_UPDATED: { target: '.deciding' } },
							states: {
								deciding: {
									type: 'choice',
									choice: (args) => {
										if (args.guards.isOrganizationRejected(args)) {
											return { target: 'rejected' }
										}
										if (args.guards.isOrganizationPending(args)) {
											return { target: 'pending' }
										}
										if (args.guards.isOrganizationSynced(args)) {
											return { target: 'synced' }
										}
										return { target: 'local' }
									}
								},
								local: {
									meta: {
										channel: 'organization',
										name: t('capture.status.saved'),
										variant: 'info'
									}
								},
								pending: {
									meta: {
										channel: 'organization',
										name: t('library.sync_pending'),
										variant: 'info'
									}
								},
								synced: {
									meta: {
										channel: 'organization',
										name: t('capture.status.synced'),
										variant: 'info'
									}
								},
								rejected: {
									meta: {
										channel: 'organization',
										name: t('capture.status.rejected'),
										variant: 'error'
									}
								}
							}
						},
						unknown: {
							meta: {
								channel: 'organization',
								name: t('capture.status.unknown'),
								variant: 'error'
							}
						},
						failed: {
							meta: {
								channel: 'organization',
								name: t('capture.status.save_failed'),
								variant: 'error'
							}
						}
					}
				},
				control: {
					initial: 'active',
					states: {
						active: {
							on: {
								SHUTDOWN: (args, enq) => {
									let patch = {}
									enq.sendTo('worker', { type: 'STOP' })
									enq.sendTo('search', { type: 'STOP' })
									enq.sendTo('receipts', { type: 'SHUTDOWN' })
									patch = {
										...patch,
										reader: undefined,
										rows: [],
										query: '',
										selectedTags: [],
										url: '',
										content: undefined,
										sync: {},
										background: {},
										backgroundCancelable: false
									}
									return { target: 'closing', context: patch }
								}
							}
						},
						closing: {}
					}
				},
				workerLifecycle: {
					initial: 'active',
					states: {
						active: {
							on: {
								BACKGROUND_CLOSED: { target: 'closed' },
								BACKGROUND_ERROR: (args) => {
									if (!matchesState({ running: { control: 'active' } }, args.value)) return
									return { target: 'failed' }
								}
							}
						},
						failed: {
							meta: { name: t('capture.status.failed'), variant: 'error', priority: 1 },
							initial: 'active',
							states: {
								active: {
									on: {
										BACKGROUND_CLOSED: { target: 'closed' },
										CAPTURE_SAVED: { target: '#library.running.workerLifecycle.active' },
										ADD: (args) => {
											if (
												!(
													matchesState({ running: { control: 'active' } }, args.value) &&
													!!args.context.capability?.isCurrent() &&
													!matchesState({ running: { capture: 'saving' } }, args.value)
												)
											)
												return
											return { target: '#library.running.workerLifecycle.active' }
										}
									}
								},
								closed: {
									on: {
										CAPTURE_SAVED: { target: '#library.running.workerLifecycle.closed' },
										ADD: (args) => {
											if (
												!(
													matchesState({ running: { control: 'active' } }, args.value) &&
													!!args.context.capability?.isCurrent() &&
													!matchesState({ running: { capture: 'saving' } }, args.value)
												)
											)
												return
											return { target: '#library.running.workerLifecycle.closed' }
										}
									}
								}
							}
						},
						closed: {}
					}
				},
				capture: {
					initial: 'idle',
					on: {
						ADD: (args) => {
							const { event } = args
							if (
								matchesState({ running: { control: 'active' } }, args.value) &&
								!!args.context.capability?.isCurrent() &&
								!matchesState({ running: { capture: 'saving' } }, args.value) &&
								isValidSourceUrl(event.url)
							) {
								return {
									target: '.saving',
									context: {
										url: event.url,
										content: event.content,
										failure: '',
										captureReady: false
									}
								}
							}
							if (
								matchesState({ running: { control: 'active' } }, args.value) &&
								!matchesState({ running: { capture: 'saving' } }, args.value)
							) {
								return { target: '.invalidUrl' }
							}
						},
						CANCEL: (args, enq) => {
							const { context } = args
							if (
								!(
									!matchesState({ running: { capture: 'saving' } }, args.value) &&
									matchesState({ running: { control: 'active' } }, args.value) &&
									context.backgroundCancelable
								)
							)
								return
							enq.sendTo('worker', {
								type: 'CANCEL',
								id: context.backgroundId
							})
						}
					},
					states: {
						idle: {},
						saving: {
							meta: {
								name: t('capture.status.saving'),
								variant: 'info'
							},
							initial: 'active',
							entry: (args, enq) => {
								return {
									context: (({ context, spawn }) => ({
										saveRef: (() => {
											const ref = required(context.capability).spawnSave(spawn, {
												url: context.url,
												...(context.content ? { content: context.content } : {})
											})
											enq.subscribeTo(ref, {
												done: (
													output
												):
													| {
															type: 'WRITE_DONE'
															actorId: string
															output: ArticleSaveResult | FakeDataOutcome
													  }
													| { type: 'WRITE_ERROR'; actorId: string; error: unknown } => ({
													type: 'WRITE_DONE',
													actorId: ref.id,
													output
												}),
												error: (
													error
												):
													| {
															type: 'WRITE_DONE'
															actorId: string
															output: ArticleSaveResult | FakeDataOutcome
													  }
													| { type: 'WRITE_ERROR'; actorId: string; error: unknown } => ({
													type: 'WRITE_ERROR',
													actorId: ref.id,
													error
												})
											})
											return ref
										})()
									}))({ ...args, spawn: enq.spawn })
								}
							},
							exit: (args, enq) => {
								enq.stop(required(args.context.saveRef))
								return { context: { saveRef: undefined, content: undefined } }
							},
							states: {
								active: {
									on: {
										SHUTDOWN: (args, enq) => {
											enq.sendTo(required(args.context.saveRef), {
												type: 'SHUTDOWN'
											})
											return { target: 'stopping' }
										},
										CANCEL: (args, enq) => {
											enq.sendTo(required(args.context.saveRef), {
												type: 'SHUTDOWN'
											})
											return { target: 'stopping' }
										}
									}
								},
								stopping: {}
							},
							on: {
								WRITE_DONE: (args, enq) => {
									const { context, event } = args
									if (
										matchesState({ running: { control: 'closing' } }, args.value) &&
										event.actorId === context.saveRef?.id
									) {
										return { target: 'canceled' }
									}
									if (
										event.actorId === context.saveRef?.id &&
										(saveOutcome(event.output).kind === 'saved' ||
											saveOutcome(event.output).kind === 'duplicate')
									) {
										enq.raise({ type: 'WATCH_RECEIPTS', result: saveOutcome(args.event.output) })
										enq.raise({ type: 'CAPTURE_SAVED' })
										return {
											target: 'saved',
											context: {
												captureId: saveOutcome(event.output).operationId,
												captureReady: savedResult(event.output).ready === true,
												failure: saveOutcome(event.output).kind === 'duplicate' ? 'duplicate' : ''
											}
										}
									}
									if (
										event.actorId === context.saveRef?.id &&
										saveOutcome(event.output).kind === 'interrupted'
									) {
										return { target: 'canceled' }
									}
									if (
										event.actorId === context.saveRef?.id &&
										saveOutcome(event.output).kind === 'failed'
									) {
										return { target: 'failed' }
									}
									if (event.actorId === context.saveRef?.id) {
										return {
											target: 'uncertain',
											context: { captureId: saveOutcome(event.output).operationId }
										}
									}
								},
								WRITE_ERROR: (args) => {
									if (!(args.event.actorId === args.context.saveRef?.id)) return
									return { target: 'uncertain' }
								}
							}
						},
						saved: {
							initial: 'deciding',
							on: { CAPTURE_UPDATED: { target: '.deciding' } },
							states: {
								deciding: {
									type: 'choice',
									choice: (args) => {
										if (args.guards.hasCaptureBackground(args)) {
											return { target: 'background' }
										}
										if (args.guards.isDuplicateCapture(args)) {
											return { target: 'duplicate' }
										}
										if (args.guards.isCaptureSynced(args)) {
											return { target: 'synced' }
										}
										if (args.guards.isCaptureRejected(args)) {
											return { target: 'rejected' }
										}
										return { target: 'local' }
									}
								},
								local: { meta: { name: t('capture.status.saved'), variant: 'info' } },
								duplicate: {
									meta: {
										name: t('capture.status.duplicate'),
										variant: 'info',
										channel: 'duplicate'
									}
								},
								synced: { meta: { name: t('capture.status.synced'), variant: 'info' } },
								rejected: {
									meta: {
										name: t('capture.status.rejected'),
										variant: 'error',
										channel: 'capture-problem'
									}
								},
								background: {
									meta: { message: (context) => required(context.background[context.captureId]) }
								}
							}
						},
						invalidUrl: {
							meta: {
								name: t('capture.errors.invalid_url'),
								variant: 'error',
								channel: 'capture-problem'
							}
						},
						failed: {
							meta: {
								name: t('capture.status.save_failed'),
								variant: 'error',
								channel: 'capture-problem'
							}
						},
						uncertain: {
							meta: {
								name: t('capture.status.unknown'),
								variant: 'error',
								channel: 'capture-problem'
							}
						},
						canceled: {
							meta: {
								name: t('capture.status.canceled'),
								variant: 'info'
							}
						}
					}
				},
				reading: {
					initial: 'empty',
					on: {
						OPEN: (args) => {
							const { context } = args
							if (
								!(
									matchesState({ running: { control: 'active' } }, args.value) &&
									!!context.capability?.isCurrent()
								)
							)
								return
							return {
								target: '.loading',
								context: {
									readerId: args.event.id,
									readerGeneration: context.readerGeneration + 1,
									reader: undefined
								}
							}
						},
						CLOSE_READER: (args) => {
							return {
								target: '.empty',
								context: {
									readerId: '',
									reader: undefined,
									readerGeneration: args.context.readerGeneration + 1
								}
							}
						},
						READ_RESULT: (args) => {
							const { context, event } = args
							if (
								!(
									matchesState({ running: { control: 'active' } }, args.value) &&
									!!context.capability?.isCurrent() &&
									event.generation === context.readerGeneration
								)
							)
								return
							return { target: '.shown', context: { reader: event.result } }
						}
					},
					states: {
						empty: {},
						loading: {
							meta: { channel: 'reader', name: t('reader.loading'), variant: 'info' },
							invoke: {
								id: 'read',
								src: 'read',
								input: ({ context, self }) => ({
									capability: required(context.capability).read,
									id: context.readerId,
									generation: context.readerGeneration,
									reportTo: self
								}),
								onError: () => {
									return { target: 'shown', context: { reader: { kind: 'unavailable' } } }
								}
							}
						},
						shown: {
							initial: 'deciding',
							states: {
								deciding: {
									type: 'choice',
									choice: (args) => {
										if (args.guards.isReaderAvailable(args)) {
											return { target: 'available' }
										}
										return { target: 'unavailable' }
									}
								},
								available: {},
								unavailable: {
									meta: {
										channel: 'reader',
										name: t('reader.unavailable'),
										variant: 'error'
									}
								}
							}
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
						capability: undefined,
						fakeDataRef: undefined,
						organizationRef: undefined,
						organizationRequest: undefined,
						organizationId: '',
						organizationOperations: {},
						reader: undefined,
						rows: [],
						selectedTags: [],
						query: '',
						sync: {},
						background: {},
						url: '',
						content: undefined,
						captureId: '',
						failure: ''
					}
				}
			}
		}
	}
})
type LibrarySnapshot = SnapshotFrom<typeof libraryMachine>
function visibleLibrary(snapshot: LibrarySnapshot | undefined) {
	return (
		snapshot?.status === 'active' &&
		snapshot.matches({ running: { control: 'active' } }) &&
		snapshot.context.capability?.isCurrent() === true
	)
}
export function selectLibraryReaderExperience(snapshot: LibrarySnapshot | undefined) {
	return selectReaderExperience(
		visibleLibrary(snapshot) ? snapshot?.children.readerExperience?.getSnapshot() : undefined
	)
}
export function selectLibraryReaderView(snapshot: LibrarySnapshot | undefined) {
	const visible = visibleLibrary(snapshot)
	return {
		readerExperience: selectLibraryReaderExperience(snapshot),
		imageViews: visible ? (snapshot?.children.images?.getSnapshot().context.views ?? {}) : {},
		readerMessage: !snapshot
			? ({ text: t('reader.loading'), variant: 'info' } satisfies WorkflowMessage)
			: visible
				? stateFeedback(Object.values(snapshot.getMeta()), 'reader')
				: undefined,
		canOrganize:
			visible &&
			!!snapshot?.context.capability?.spawnOrganization &&
			!snapshot?.matches({ running: { organization: 'writing' } })
	}
}
export function selectLibraryCaptureView(snapshot: LibrarySnapshot | undefined) {
	const visible = visibleLibrary(snapshot)
	const c = snapshot?.context
	const meta = visible && snapshot ? Object.values(snapshot.getMeta()) : []
	const captured =
		visible && c?.captureId
			? c.rows.find((row) => row.id === c.captureId || row.contentId === c.captureId)
			: undefined
	return {
		restoreCaptureId: captured?.trashed ? captured.id : undefined,
		canOrganize:
			visible &&
			!!c?.capability?.spawnOrganization &&
			!snapshot?.matches({ running: { organization: 'writing' } }),
		duplicateMessage: stateFeedback(meta, 'duplicate'),
		captureProblemMessage: stateFeedback(meta, 'capture-problem')
	}
}
type RowView = { rows: LibraryArticle[]; readable: Record<string, boolean> }
const rowViews = new WeakMap<LibraryArticle[], { inputs: readonly unknown[]; view: RowView }>()
function selectRows(
	c: Context,
	resultIds: string[] | undefined,
	progress: ReturnType<typeof selectReaderExperience>['progress']
): RowView {
	const inputs = [c.view, c.favorites, c.selectedTags, c.query, resultIds, progress]
	const cached = rowViews.get(c.rows)
	if (cached?.inputs.every((value, i) => value === inputs[i])) return cached.view
	const matches = c.rows.filter(
		(row) => matchesLibraryFilter(row, c.view, c.favorites) && matchesTags(row, c.selectedTags)
	)
	const byId = new Map(matches.map((row) => [row.id, row]))
	const filtered = c.query.trim()
		? (resultIds?.flatMap((id) => {
				const row = byId.get(id)
				return row ? [row] : []
			}) ?? [])
		: matches
	const view = {
		rows: filtered.map((row) => ({
			...row,
			readingProgress: row.contentId ? progress[row.contentId] : undefined
		})),
		readable: Object.fromEntries(c.rows.map((row) => [row.id, !!row.contentId]))
	}
	rowViews.set(c.rows, { inputs, view })
	return view
}
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
	const forwardedState = meta.find((state) => state?.message)
	const search = selectSearchView(visible ? snapshot.children.search?.getSnapshot() : undefined)
	const resultIds = search.query === c?.query ? search.ids : undefined
	const captured = visible
		? c.rows.find((row) => row.id === c.captureId || row.contentId === c.captureId)
		: undefined

	const readerExperience = selectLibraryReaderExperience(snapshot)
	const { rows, readable } = visible
		? selectRows(c, resultIds, readerExperience.progress)
		: { rows: [], readable: {} }

	return {
		imageViews: visible ? (snapshot?.children.images?.getSnapshot().context.views ?? {}) : {},
		readerExperience,
		rows,
		search,
		restoreCaptureId: captured?.trashed ? captured.id : undefined,
		tags: visible ? (c.rows[0]?.tagVocabulary ?? []) : [],
		organizationMessage: stateFeedback(meta, 'organization'),
		canOrganize:
			visible &&
			!!c.capability?.spawnOrganization &&
			!snapshot.matches({ running: { organization: 'writing' } }),
		duplicateMessage: stateFeedback(meta, 'duplicate'),
		captureProblemMessage: stateFeedback(meta, 'capture-problem'),
		captureMessage:
			stateFeedback(meta, 'capture-problem') ??
			stateFeedback(meta) ??
			stateFeedback(meta, 'duplicate') ??
			(c ? forwardedState?.message?.(c) : undefined),
		readerMessage: !snapshot
			? ({ text: t('reader.loading'), variant: 'info' } satisfies WorkflowMessage)
			: visible
				? stateFeedback(meta, 'reader')
				: undefined,
		listMessage:
			visible && c.listFailed
				? ({ text: t('library.list_failed'), variant: 'error' } satisfies WorkflowMessage)
				: undefined,
		emptyMessage:
			visible && !rows.length && (!c.query.trim() || resultIds !== undefined)
				? {
						text: t(c.rows.length ? 'library.filtered_empty' : 'library.empty'),
						variant: 'info'
					}
				: undefined,
		readable,
		canOpenCapture:
			visible && c.captureReady && !c.background[c.captureId] && captured?.trashed !== true,
		canCancel:
			visible &&
			snapshot.can({ type: 'CANCEL' }) &&
			(snapshot.matches({ running: { capture: 'saving' } }) || c.backgroundCancelable)
	}
}
