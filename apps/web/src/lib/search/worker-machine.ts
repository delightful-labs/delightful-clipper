import { assign, fromPromise, setup } from 'xstate'
import type MiniSearch from 'minisearch'
import type { CachedIndex } from './cache.js'
import { buildIndex, restoreIndex, searchFingerprint, searchIndex } from './engine.js'
import type { SearchDocument } from './engine.js'
import type { SearchWorkerInput, SearchWorkerOutput } from './protocol.js'
type Dataset = Extract<SearchWorkerInput, { type: 'INDEX' }>
type Context = {
	dataset: Dataset | undefined
	fingerprint: string
	cached: CachedIndex | undefined
	index: MiniSearch<SearchDocument> | undefined
}
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Search resource unavailable')
	return value
}
export function createSearchWorkerMachine(cap: {
	read: (key: string) => Promise<CachedIndex | undefined>
	write: (key: string, value: CachedIndex) => Promise<void>
	report: (message: SearchWorkerOutput) => void
}) {
	const model = setup<
		Context,
		SearchWorkerInput | { type: 'STOP' },
		{
			fingerprint: ReturnType<typeof fromPromise<string, Dataset>>
			read: ReturnType<typeof fromPromise<CachedIndex | undefined, string>>
			restore: ReturnType<typeof fromPromise<MiniSearch<SearchDocument>, string>>
			build: ReturnType<typeof fromPromise<MiniSearch<SearchDocument>, Dataset>>
			write: ReturnType<typeof fromPromise<void, { key: string; value: CachedIndex }>>
		},
		{},
		{},
		{ cacheMatches: undefined; currentQuery: undefined },
		never,
		string
	>({
		actors: {
			fingerprint: fromPromise(({ input }) => searchFingerprint(input.documents)),
			read: fromPromise(({ input }) => cap.read(input)),
			restore: fromPromise(async ({ input }) => restoreIndex(input)),
			build: fromPromise(({ input }) => buildIndex(input.documents)),
			write: fromPromise(({ input }) => cap.write(input.key, input.value))
		},
		guards: {
			cacheMatches: ({ context }) => context.cached?.fingerprint === context.fingerprint,
			currentQuery: ({ context, event }) =>
				event.type === 'QUERY' && event.generation === context.dataset?.generation
		}
	})
	return model.createMachine({
		id: 'search-index-worker',
		initial: 'waiting',
		context: { dataset: undefined, fingerprint: '', cached: undefined, index: undefined },
		on: {
			INDEX: {
				target: '.fingerprinting',
				actions: assign({
					dataset: ({ event }) => event,
					fingerprint: '',
					cached: undefined,
					index: undefined
				})
			},
			STOP: '.closed'
		},
		states: {
			waiting: {},
			fingerprinting: {
				invoke: {
					src: 'fingerprint',
					input: ({ context }) => required(context.dataset),
					onDone: {
						target: 'readingCache',
						actions: assign({ fingerprint: ({ event }) => event.output })
					},
					onError: 'failed'
				}
			},
			readingCache: {
				invoke: {
					src: 'read',
					input: ({ context }) => required(context.dataset).key,
					onDone: {
						target: 'checkingCache',
						actions: assign({ cached: ({ event }) => event.output })
					},
					onError: 'building'
				}
			},
			checkingCache: {
				always: [{ guard: 'cacheMatches', target: 'restoring' }, { target: 'building' }]
			},
			restoring: {
				invoke: {
					src: 'restore',
					input: ({ context }) => required(context.cached).index,
					onDone: { target: 'ready', actions: assign({ index: ({ event }) => event.output }) },
					onError: 'building'
				}
			},
			building: {
				invoke: {
					src: 'build',
					input: ({ context }) => required(context.dataset),
					onDone: { target: 'persisting', actions: assign({ index: ({ event }) => event.output }) },
					onError: 'failed'
				}
			},
			persisting: {
				invoke: {
					src: 'write',
					input: ({ context }) => ({
						key: required(context.dataset).key,
						value: {
							fingerprint: context.fingerprint,
							index: JSON.stringify(required(context.index))
						}
					}),
					onDone: 'ready',
					onError: 'ready'
				}
			},
			ready: {
				entry: ({ context }) =>
					cap.report({ type: 'INDEX_READY', generation: required(context.dataset).generation }),
				on: {
					QUERY: {
						guard: 'currentQuery',
						actions: ({ context, event }) =>
							cap.report({
								type: 'RESULT',
								generation: event.generation,
								query: event.query,
								ids: searchIndex(required(context.index), event.query)
							})
					}
				}
			},
			failed: { entry: () => cap.report({ type: 'WORKER_ERROR' }) },
			closed: {
				type: 'final',
				entry: assign({ dataset: undefined, fingerprint: '', cached: undefined, index: undefined })
			}
		}
	})
}
