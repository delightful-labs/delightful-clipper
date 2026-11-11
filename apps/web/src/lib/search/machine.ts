import type { EventPayload } from '../machines/events.js'
import { types, createCallbackLogic, setup, matchesState, type SnapshotFrom } from 'xstate'

import { stateFeedback } from '../contracts/feedback.js'
import type { SearchResource } from '../contracts/search.js'
import type { SearchCapability } from '../contracts/search.js'
import type { LibraryArticle } from '../contracts/articles.js'
import type { SearchWorkerInput, SearchWorkerOutput } from './protocol.js'
import type { SearchDocument } from './schema.js'
import { querySchema } from './schema.js'
import { t } from '../localization/index.js'
import {
	SEARCH_WAIT_POLICY,
	monotonicNow,
	withinResourceDeadline,
	type SearchWaitPolicy
} from '../contracts/resource-waits.js'
type Event =
	| (SearchWorkerOutput & { elapsedMs: number })
	| { type: 'LOAD_RETURNED'; documents: SearchDocument[]; elapsedMs: number }
	| { type: 'LOAD_FAILED'; elapsedMs: number }
	| { type: 'ROWS'; rows: LibraryArticle[] }
	| { type: 'QUERY'; query: string }
	| { type: 'DIRTY' | 'RETRY' | 'STOP' | 'ACTIVATE' }
type Input = {
	capability: SearchCapability | undefined
	waits?: Partial<SearchWaitPolicy>
	now?: () => number
}
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
	const resource = createCallbackLogic<
		SearchWorkerInput | { type: 'RETIRE' },
		{ capability: SearchCapability; now?: () => number }
	>(({ input, receive, sendBack }) => {
		let worker: SearchResource | undefined
		let unsubscribe: (() => void) | undefined
		let disposed = false
		const now = input.now ?? monotonicNow
		let startedAt = now()
		const release = () => {
			if (disposed) return
			disposed = true
			try {
				unsubscribe?.()
			} finally {
				worker?.dispose()
			}
		}
		const report = (event: SearchWorkerOutput) => {
			if (!disposed) sendBack({ ...event, elapsedMs: now() - startedAt })
		}
		receive((event) => {
			if (event.type === 'RETIRE') {
				release()
				return
			}
			if (disposed) return
			startedAt = now()
			try {
				worker?.post(event)
			} catch {
				report({ type: 'WORKER_ERROR' })
			}
		})
		try {
			worker = input.capability.open(report)
			unsubscribe = input.capability.observe(
				() => {
					if (!disposed) sendBack({ type: 'DIRTY' })
				},
				() => report({ type: 'WORKER_ERROR' })
			)
		} catch {
			report({ type: 'WORKER_ERROR' })
		}
		return release
	})
	// Aborting requests cancellation; the original promise remains observed until
	// settlement because Jazz's underlying reads do not accept AbortSignal.
	const load = createCallbackLogic<
		{ type: 'CANCEL' },
		{ cap: SearchCapability; rows: LibraryArticle[]; now?: () => number }
	>(({ input, receive, sendBack }) => {
		const controller = new AbortController(),
			now = input.now ?? monotonicNow,
			startedAt = now()
		receive(() => controller.abort())
		void Promise.resolve()
			.then(() => input.cap.load(input.rows, controller.signal))
			.then(
				(documents) => sendBack({ type: 'LOAD_RETURNED', documents, elapsedMs: now() - startedAt }),
				() => sendBack({ type: 'LOAD_FAILED', elapsedMs: now() - startedAt })
			)
		return () => controller.abort()
	})
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
				ACTIVATE: types<EventPayload<Event, 'ACTIVATE'>>(),
				LOAD_RETURNED: types<EventPayload<Event, 'LOAD_RETURNED'>>(),
				LOAD_FAILED: types<{ elapsedMs: number }>()
			},
			input: types<Input>(),
			output: types<undefined>(),
			meta: types<{ name?: string; variant?: 'info' | 'error'; outcome?: 'overdue' | 'failed' }>(),
			tags: types<string>(),
			children: {
				resource: types<import('xstate').ActorRefFrom<typeof resource>>(),
				load: types<import('xstate').ActorRefFrom<typeof load>>()
			}
		},
		actors: { resource, load },
		delays: {
			loadDeadline: ({ context }) => context.waits?.loadMs ?? SEARCH_WAIT_POLICY.loadMs,
			indexDeadline: ({ context }) => context.waits?.indexMs ?? SEARCH_WAIT_POLICY.indexMs,
			queryDeadline: ({ context }) => context.waits?.queryMs ?? SEARCH_WAIT_POLICY.queryMs
		},
		guards: {
			loadCompletionOverdue: ({ context, value }, result: { elapsedMs: number }) =>
				matchesState({ running: { loading: 'overdue' } }, value) ||
				!withinResourceDeadline(
					result.elapsedMs,
					context.waits?.loadMs ?? SEARCH_WAIT_POLICY.loadMs
				),
			loadFailed: ({ value }) =>
				matchesState({ running: { loading: 'overdue' } }, value) ||
				matchesState({ running: { loading: 'broken' } }, value),
			stopping: ({ value }) => matchesState({ running: { loading: 'stopping' } }, value),
			withinDeadline: ({ context }, params: { elapsedMs: number; stage: keyof SearchWaitPolicy }) =>
				withinResourceDeadline(
					params.elapsedMs,
					context.waits?.[params.stage] ?? SEARCH_WAIT_POLICY[params.stage]
				),
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
					input: ({ context }: { context: Context }) => ({
						capability: required(context.capability),
						now: context.now ?? monotonicNow
					})
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
						states: {
							current: {},
							stale: {},
							overdue: {
								meta: { name: t('library.search_failed'), variant: 'error' },
								entry: (_args, enq) => {
									enq.sendTo('resource', { type: 'RETIRE' })
									enq.sendTo('load', { type: 'CANCEL' })
								}
							},
							broken: {
								meta: { name: t('library.search_failed'), variant: 'error' },
								entry: (_args, enq) => {
									enq.sendTo('resource', { type: 'RETIRE' })
									enq.sendTo('load', { type: 'CANCEL' })
								}
							},
							stopping: {
								entry: (_args, enq) => {
									enq.sendTo('resource', { type: 'RETIRE' })
									enq.sendTo('load', { type: 'CANCEL' })
								},
								on: { ROWS: {}, DIRTY: {}, QUERY: {}, STOP: {}, WORKER_ERROR: {} }
							}
						},
						timeout: 'loadDeadline',
						onTimeout: (args) =>
							args.guards.stopping(args) || args.guards.loadFailed(args)
								? undefined
								: { target: '.overdue' },
						// Drain an issued native read before loading the newest dataset.
						// Jazz's public read API has no AbortSignal; invalidation must not
						// start overlapping whole-library reads.
						on: {
							STOP: { target: '.stopping', context: { rows: [], query: '', ids: [] } },
							WORKER_ERROR: (args) =>
								args.guards.loadFailed(args) ? undefined : { target: '.broken' },
							LOAD_RETURNED: (args, enq) => {
								if (args.guards.stopping(args) || !args.guards.supported(args))
									return { target: '#library-search.closed' }
								if (args.guards.loadCompletionOverdue(args, args.event))
									return { target: '#library-search.failed.overdue' }
								if (args.guards.loadFailed(args)) return { target: '#library-search.failed' }
								if (args.guards.loadStale(args)) return { target: 'scheduling' }
								enq.sendTo('resource', {
									type: 'INDEX',
									key: 'clipper-search-v1:' + required(args.context.capability).libraryId,
									generation: args.context.generation,
									documents: args.event.documents
								})
								return { target: 'indexing' }
							},
							LOAD_FAILED: (args) => {
								if (args.guards.stopping(args) || !args.guards.supported(args))
									return { target: '#library-search.closed' }
								if (args.guards.loadCompletionOverdue(args, args.event))
									return { target: '#library-search.failed.overdue' }
								if (!args.guards.loadFailed(args) && args.guards.loadStale(args))
									return { target: 'scheduling' }
								return { target: '#library-search.failed' }
							},
							ROWS: (args) => {
								const { event } = args
								if (!args.guards.supported(args)) {
									return { target: '.stopping' }
								}
								if (args.guards.unchangedRows(args)) {
									return { context: { rows: event.rows } }
								}
								return {
									...(args.guards.loadFailed(args) ? {} : { target: '.stale' }),
									context: { rows: event.rows, generation: args.context.generation + 1 }
								}
							},
							DIRTY: (args) => {
								if (args.guards.supported(args)) {
									return {
										...(args.guards.loadFailed(args) ? {} : { target: '.stale' }),
										context: { generation: args.context.generation + 1 }
									}
								}
								return { target: '.stopping' }
							}
						},
						entry: () => {
							return { context: { ids: [] } }
						},
						invoke: {
							id: 'load',
							src: 'load',
							input: ({ context }) => ({
								cap: required(context.capability),
								rows: context.rows,
								now: context.now ?? monotonicNow
							})
						}
					},
					indexing: {
						timeout: 'indexDeadline',
						onTimeout: { target: '#library-search.failed.overdue' },
						on: {
							INDEX_READY: (args) => {
								if (!args.guards.currentGeneration(args)) return
								if (
									!args.guards.withinDeadline(args, {
										elapsedMs: args.event.elapsedMs,
										stage: 'indexMs'
									})
								)
									return { target: '#library-search.failed.overdue' }
								return { target: 'querying' }
							}
						}
					},
					querying: {
						timeout: 'queryDeadline',
						onTimeout: { target: '#library-search.failed.overdue' },
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
								if (
									!args.guards.withinDeadline(args, {
										elapsedMs: args.event.elapsedMs,
										stage: 'queryMs'
									})
								)
									return { target: '#library-search.failed.overdue' }
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
				initial: 'rejected',
				states: {
					rejected: { meta: { outcome: 'failed' } },
					overdue: { meta: { outcome: 'overdue' } }
				},
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
