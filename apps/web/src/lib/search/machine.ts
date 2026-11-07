import { assign, fromCallback, fromPromise, sendTo, setup, not, and, stateIn } from 'xstate'
import type { SnapshotFrom } from 'xstate'
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
	const resource = fromCallback<SearchWorkerInput, SearchCapability>(
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
	const load = fromPromise<SearchDocument[], { cap: SearchCapability; rows: LibraryArticle[] }>(
		({ input, signal }) => input.cap.load(input.rows, signal)
	)
	const model = setup<
		Context,
		Event,
		{ resource: typeof resource; load: typeof load },
		{},
		{ rememberQuery: undefined; queryWorker: undefined },
		{
			supported: undefined
			validQuery: undefined
			hasQuery: undefined
			loadStale: undefined
			currentGeneration: undefined
			currentResult: undefined
			unchangedRows: undefined
		},
		never,
		string,
		Input,
		undefined,
		{ type: string },
		{ name?: string; variant?: 'info' | 'error' }
	>({
		actors: { resource, load },
		guards: {
			loadStale: stateIn({ running: { loading: 'stale' } }),
			supported: ({ context }) => context.capability?.isCurrent() === true,
			hasQuery: ({ event }) => event.type === 'QUERY' && event.query.trim().length > 0,
			validQuery: ({ context, event }) =>
				event.type === 'QUERY' &&
				context.capability?.isCurrent() === true &&
				querySchema.safeParse(event.query).success,
			currentGeneration: ({ context, event }) =>
				context.capability?.isCurrent() === true &&
				'generation' in event &&
				event.generation === context.generation,
			currentResult: ({ context, event }) =>
				context.capability?.isCurrent() === true &&
				event.type === 'RESULT' &&
				event.generation === context.generation &&
				event.query === context.query,
			unchangedRows: ({ context, event }) =>
				event.type === 'ROWS' && sameSearchRows(context.rows, event.rows)
		},
		actions: {
			rememberQuery: assign({
				query: ({ context, event }) => (event.type === 'QUERY' ? event.query : context.query)
			}),
			queryWorker: sendTo('resource', ({ context }) => ({
				type: 'QUERY',
				generation: context.generation,
				query: context.query
			}))
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
		on: { STOP: '.closed' },
		states: {
			admitting: { always: [{ guard: 'supported', target: 'dormant' }, { target: 'disabled' }] },
			dormant: {
				on: {
					ROWS: [
						{ guard: not('supported'), target: '#library-search.closed' },
						{ actions: assign({ rows: ({ event }) => event.rows }) }
					],
					ACTIVATE: { guard: 'supported', target: 'running' },
					QUERY: [
						{ guard: and(['validQuery', 'hasQuery']), target: 'running', actions: 'rememberQuery' },
						{ guard: 'validQuery', actions: 'rememberQuery' }
					]
				}
			},
			running: {
				invoke: {
					id: 'resource',
					src: 'resource',
					input: ({ context }) => required(context.capability)
				},
				initial: 'scheduling',
				on: {
					ROWS: [
						{ guard: not('supported'), target: '#library-search.closed' },
						{ guard: 'unchangedRows', actions: assign({ rows: ({ event }) => event.rows }) },
						{
							target: '.scheduling',
							reenter: false,
							actions: assign({
								rows: ({ event }) => event.rows,
								generation: ({ context }) => context.generation + 1
							})
						}
					],
					DIRTY: [
						{
							guard: 'supported',
							target: '.scheduling',
							actions: assign({ generation: ({ context }) => context.generation + 1 })
						},
						{ target: '#library-search.closed' }
					],
					QUERY: { guard: 'validQuery', actions: 'rememberQuery' },
					WORKER_ERROR: '#library-search.failed'
				},
				states: {
					scheduling: {
						entry: assign({ ids: [] }),
						after: { 16: 'loading' }
					},
					loading: {
						initial: 'current',
						states: { current: {}, stale: {} },
						// Drain an issued native read before loading the newest dataset.
						// Jazz's public read API has no AbortSignal; invalidation must not
						// start overlapping whole-library reads.
						on: {
							ROWS: [
								{ guard: not('supported'), target: '#library-search.closed' },
								{ guard: 'unchangedRows', actions: assign({ rows: ({ event }) => event.rows }) },
								{
									target: '.stale',
									actions: assign({
										rows: ({ event }) => event.rows,
										generation: ({ context }) => context.generation + 1
									})
								}
							],
							DIRTY: [
								{
									guard: 'supported',
									target: '.stale',
									actions: assign({ generation: ({ context }) => context.generation + 1 })
								},
								{ target: '#library-search.closed' }
							]
						},
						entry: assign({ ids: [] }),
						invoke: {
							src: 'load',
							input: ({ context }) => ({ cap: required(context.capability), rows: context.rows }),
							onDone: [
								{ guard: and(['supported', 'loadStale']), target: 'scheduling' },
								{
									guard: 'supported',
									target: 'indexing',
									actions: sendTo('resource', ({ context, event }) => ({
										type: 'INDEX',
										key: 'clipper-search-v1:' + required(context.capability).libraryId,
										generation: context.generation,
										documents: event.output
									}))
								},
								{ target: '#library-search.closed' }
							],
							onError: [
								{ guard: and(['supported', 'loadStale']), target: 'scheduling' },
								{ target: '#library-search.failed' }
							]
						}
					},
					indexing: {
						on: { INDEX_READY: { guard: 'currentGeneration', target: 'querying' } }
					},
					querying: {
						entry: 'queryWorker',
						on: {
							QUERY: {
								guard: 'validQuery',
								target: 'querying',
								reenter: true,
								actions: 'rememberQuery'
							},
							RESULT: {
								guard: 'currentResult',
								target: 'ready',
								actions: assign({
									ids: ({ event }) => event.ids
								})
							}
						}
					},
					ready: {
						on: { QUERY: { guard: 'validQuery', target: 'querying', actions: 'rememberQuery' } }
					}
				}
			},
			failed: {
				meta: { name: t('library.search_failed'), variant: 'error' },
				on: {
					RETRY: {
						guard: 'supported',
						target: 'running',
						actions: assign({ generation: ({ context }) => context.generation + 1 })
					},
					ROWS: { actions: assign({ rows: ({ event }) => event.rows }) },
					QUERY: { guard: 'validQuery', actions: 'rememberQuery' }
				}
			},
			disabled: {},
			closed: {
				type: 'final',
				entry: assign({
					capability: undefined,
					rows: [],
					query: '',
					ids: []
				})
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
