import { assign, fromCallback, fromPromise, sendTo, setup, not } from 'xstate'
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
	| { type: 'DIRTY' | 'RETRY' | 'STOP' }
type Input = { capability: SearchCapability | undefined }
type Context = Input & {
	rows: LibraryArticle[]
	query: string
	generation: number
	ids: string[]
	matchedQuery: string | undefined
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
			supported: ({ context }) => context.capability?.isCurrent() === true,
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
			ids: [],
			matchedQuery: undefined
		}),
		on: { STOP: '.closed' },
		states: {
			admitting: { always: [{ guard: 'supported', target: 'running' }, { target: 'disabled' }] },
			running: {
				invoke: {
					id: 'resource',
					src: 'resource',
					input: ({ context }) => required(context.capability)
				},
				initial: 'loading',
				on: {
					ROWS: [
						{ guard: not('supported'), target: '#library-search.closed' },
						{ guard: 'unchangedRows', actions: assign({ rows: ({ event }) => event.rows }) },
						{
							target: '.loading',
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
							target: '.loading',
							actions: assign({ generation: ({ context }) => context.generation + 1 })
						},
						{ target: '#library-search.closed' }
					],
					QUERY: { guard: 'validQuery', actions: 'rememberQuery' },
					WORKER_ERROR: '#library-search.failed'
				},
				states: {
					loading: {
						entry: assign({ ids: [], matchedQuery: undefined }),
						invoke: {
							src: 'load',
							input: ({ context }) => ({ cap: required(context.capability), rows: context.rows }),
							onDone: [
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
							onError: '#library-search.failed'
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
									ids: ({ event }) => event.ids,
									matchedQuery: ({ event }) => event.query
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
					ids: [],
					matchedQuery: undefined
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
