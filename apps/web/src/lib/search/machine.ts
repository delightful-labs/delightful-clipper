import type { EventPayload } from '../machines/events.js'
import {
	types,
	createCallbackLogic,
	setup,
	createAsyncLogic,
	matchesState,
	type SnapshotFrom
} from 'xstate'

import { stateFeedback } from '../contracts/feedback.js'
import type { SearchResource } from '../contracts/search.js'
import type { SearchCapability } from '../contracts/search.js'
import type { LibraryArticle } from '../contracts/articles.js'
import type { SearchWorkerInput, SearchWorkerOutput } from './protocol.js'
import type { SearchDocument } from './schema.js'
import { querySchema } from './schema.js'
import { t } from '../localization/index.js'
type Event =
	| SearchWorkerOutput
	| { type: 'ROWS'; rows: LibraryArticle[] }
	| { type: 'QUERY'; query: string }
	| { type: 'DIRTY' | 'RETRY' | 'STOP' | 'ACTIVATE' }
type Input = { capability: SearchCapability | undefined }
type Context = Input & {
	rows: LibraryArticle[]
	query: string
	generation: number
	ids: string[]
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Search resource unavailable')
	return value
}
function sameSearchRows(a: LibraryArticle[], b: LibraryArticle[]) {
	if (a.length !== b.length) return false
	return a.every((row, i) => {
		const other = b[i]
		return (
			other?.id === row.id &&
			other.title === row.title &&
			other.url === row.url &&
			other.contentId === row.contentId &&
			other.originalSavedAt === row.originalSavedAt &&
			JSON.stringify((other.tags ?? []).map((tag) => tag.name)) ===
				JSON.stringify((row.tags ?? []).map((tag) => tag.name))
		)
	})
}
export function createSearchMachine() {
	const resource = createCallbackLogic<SearchWorkerInput, SearchCapability>(
		({ input, receive, sendBack }) => {
			let worker: SearchResource | undefined
			let unsubscribe: (() => void) | undefined
			try {
				const opened = input.open(sendBack)
				worker = opened
				unsubscribe = input.observe(
					() => sendBack({ type: 'DIRTY' }),
					() => sendBack({ type: 'WORKER_ERROR' })
				)
				receive((event) => opened.post(event))
			} catch {
				sendBack({ type: 'WORKER_ERROR' })
			}
			return () => {
				try {
					unsubscribe?.()
				} finally {
					worker?.dispose()
				}
			}
		}
	)
	const load = createAsyncLogic<
		SearchDocument[],
		{ cap: SearchCapability; rows: LibraryArticle[] }
	>({ run: ({ input, signal }) => input.cap.load(input.rows, signal) })
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				INDEX_READY: types<EventPayload<Event, 'INDEX_READY'>>(),
				RESULT: types<EventPayload<Event, 'RESULT'>>(),
				WORKER_ERROR: types<EventPayload<Event, 'WORKER_ERROR'>>(),
				ROWS: types<EventPayload<Event, 'ROWS'>>(),
				QUERY: types<EventPayload<Event, 'QUERY'>>(),
				RETRY: types<EventPayload<Event, 'RETRY'>>(),
				STOP: types<EventPayload<Event, 'STOP'>>(),
				DIRTY: types<EventPayload<Event, 'DIRTY'>>(),
				ACTIVATE: types<EventPayload<Event, 'ACTIVATE'>>()
			},
			input: types<Input>(),
			output: types<undefined>(),
			meta: types<{ name?: string; variant?: 'info' | 'error' }>(),
			tags: types<string>(),
			children: {
				resource: types<import('xstate').ActorRefFrom<typeof resource>>(),
				load: types<import('xstate').ActorRefFrom<typeof load>>()
			}
		},
		actors: { resource, load },
		guards: {
			loadStale: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ running: { loading: 'stale' } }, value),
			supported: ({ context }: { context: Context }) => context.capability?.isCurrent() === true,
			hasQuery: ({ event }: { event: Event }) =>
				event.type === 'QUERY' && event.query.trim().length > 0,
			validQuery: ({ context, event }: { context: Context; event: Event }) =>
				event.type === 'QUERY' &&
				context.capability?.isCurrent() === true &&
				querySchema.safeParse(event.query).success,
			currentGeneration: ({ context, event }: { context: Context; event: Event }) =>
				context.capability?.isCurrent() === true &&
				'generation' in event &&
				event.generation === context.generation,
			currentResult: ({ context, event }: { context: Context; event: Event }) =>
				context.capability?.isCurrent() === true &&
				event.type === 'RESULT' &&
				event.generation === context.generation &&
				event.query === context.query,
			unchangedRows: ({ context, event }: { context: Context; event: Event }) =>
				event.type === 'ROWS' && sameSearchRows(context.rows, event.rows)
		},
		actions: {
			rememberQuery: ({ context, event }: { context: Context; event: Event }) => ({
				context: { query: event.type === 'QUERY' ? event.query : context.query }
			})
		}
	})
	return model.createMachine({
		id: 'library-search',
		initial: 'admitting',
		context: ({ input }) => ({
			...input,
			rows: [],
			query: '',
			generation: 0,
			ids: []
		}),
		on: { STOP: { target: '.closed' } },
		states: {
			admitting: {
				type: 'choice',
				choice: (args) => {
					if (args.guards.supported(args)) {
						return { target: 'dormant' }
					}
					return { target: 'disabled' }
				}
			},
			dormant: {
				on: {
					ROWS: (args) => {
						if (!args.guards.supported(args)) {
							return { target: '#library-search.closed' }
						}
						return { context: { rows: args.event.rows } }
					},
					ACTIVATE: (args) => {
						if (!args.guards.supported(args)) return
						return { target: 'running' }
					},
					QUERY: (args) => {
						if (args.guards.validQuery(args) && args.guards.hasQuery(args)) {
							return { target: 'running', context: args.actions.rememberQuery(args).context }
						}
						if (args.guards.validQuery(args)) {
							return { context: args.actions.rememberQuery(args).context }
						}
					}
				}
			},
			running: {
				invoke: {
					id: 'resource',
					src: 'resource',
					input: ({ context }: { context: Context }) => required(context.capability)
				},
				initial: 'scheduling',
				on: {
					ROWS: (args) => {
						const { event } = args
						if (!args.guards.supported(args)) {
							return { target: '#library-search.closed' }
						}
						if (args.guards.unchangedRows(args)) {
							return { context: { rows: event.rows } }
						}
						return {
							target: '.scheduling',
							reenter: false,
							context: { rows: event.rows, generation: args.context.generation + 1 }
						}
					},
					DIRTY: (args) => {
						if (args.guards.supported(args)) {
							return { target: '.scheduling', context: { generation: args.context.generation + 1 } }
						}
						return { target: '#library-search.closed' }
					},
					QUERY: (args) => {
						if (!args.guards.validQuery(args)) return
						return { context: args.actions.rememberQuery(args).context }
					},
					WORKER_ERROR: { target: '#library-search.failed' }
				},
				states: {
					scheduling: {
						entry: () => {
							return { context: { ids: [] } }
						},
						after: { 16: { target: 'loading' } }
					},
					loading: {
						initial: 'current',
						states: { current: {}, stale: {} },
						// Drain an issued native read before loading the newest dataset.
						// Jazz's public read API has no AbortSignal; invalidation must not
						// start overlapping whole-library reads.
						on: {
							ROWS: (args) => {
								const { event } = args
								if (!args.guards.supported(args)) {
									return { target: '#library-search.closed' }
								}
								if (args.guards.unchangedRows(args)) {
									return { context: { rows: event.rows } }
								}
								return {
									target: '.stale',
									context: { rows: event.rows, generation: args.context.generation + 1 }
								}
							},
							DIRTY: (args) => {
								if (args.guards.supported(args)) {
									return { target: '.stale', context: { generation: args.context.generation + 1 } }
								}
								return { target: '#library-search.closed' }
							}
						},
						entry: () => {
							return { context: { ids: [] } }
						},
						invoke: {
							id: 'load',
							src: 'load',
							input: ({ context }: { context: Context }) => ({
								cap: required(context.capability),
								rows: context.rows
							}),
							onDone: (args, enq) => {
								const { context } = args
								if (
									args.guards.supported(args) &&
									matchesState({ running: { loading: 'stale' } }, args.value)
								) {
									return { target: 'scheduling' }
								}
								if (args.guards.supported(args)) {
									enq.sendTo('resource', {
										type: 'INDEX',
										key: 'clipper-search-v1:' + required(context.capability).libraryId,
										generation: context.generation,
										documents: args.event.output
									})
									return { target: 'indexing' }
								}
								return { target: '#library-search.closed' }
							},
							onError: (args) => {
								if (
									args.guards.supported(args) &&
									matchesState({ running: { loading: 'stale' } }, args.value)
								) {
									return { target: 'scheduling' }
								}
								return { target: '#library-search.failed' }
							}
						}
					},
					indexing: {
						on: {
							INDEX_READY: (args) => {
								if (!args.guards.currentGeneration(args)) return
								return { target: 'querying' }
							}
						}
					},
					querying: {
						entry: (args, enq) => {
							const { context } = args
							enq.sendTo('resource', {
								type: 'QUERY',
								generation: context.generation,
								query: context.query
							})
						},
						on: {
							QUERY: (args) => {
								if (!args.guards.validQuery(args)) return
								return {
									target: 'querying',
									reenter: true,
									context: args.actions.rememberQuery(args).context
								}
							},
							RESULT: (args) => {
								if (!args.guards.currentResult(args)) return
								return { target: 'ready', context: { ids: args.event.ids } }
							}
						}
					},
					ready: {
						on: {
							QUERY: (args) => {
								if (!args.guards.validQuery(args)) return
								return { target: 'querying', context: args.actions.rememberQuery(args).context }
							}
						}
					}
				}
			},
			failed: {
				meta: { name: t('library.search_failed'), variant: 'error' },
				on: {
					RETRY: (args) => {
						if (!args.guards.supported(args)) return
						return { target: 'running', context: { generation: args.context.generation + 1 } }
					},
					ROWS: (args) => {
						return { context: { rows: args.event.rows } }
					},
					QUERY: (args) => {
						if (!args.guards.validQuery(args)) return
						return { context: args.actions.rememberQuery(args).context }
					}
				}
			},
			disabled: {},
			closed: {
				type: 'final',
				entry: () => {
					return { context: { capability: undefined, rows: [], query: '', ids: [] } }
				}
			}
		}
	})
}
export function selectSearchView(
	snapshot: SnapshotFrom<ReturnType<typeof createSearchMachine>> | undefined
) {
	const current = snapshot?.context.capability?.isCurrent() === true
	return {
		query: current ? snapshot.context.query : '',
		ids: current && snapshot.matches({ running: 'ready' }) ? snapshot.context.ids : undefined,
		message: current ? stateFeedback(Object.values(snapshot.getMeta())) : undefined,
		canRetry: current && snapshot.can({ type: 'RETRY' }),
		enabled: snapshot?.context.capability?.isCurrent() ?? false
	}
}
