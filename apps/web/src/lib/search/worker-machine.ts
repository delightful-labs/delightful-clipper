import type { EventPayload } from '../machines/events.js'
import { types, setup, createAsyncLogic } from 'xstate'

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
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				INDEX: types<EventPayload<SearchWorkerInput | { type: 'STOP' }, 'INDEX'>>(),
				QUERY: types<EventPayload<SearchWorkerInput | { type: 'STOP' }, 'QUERY'>>(),
				STOP: types<EventPayload<SearchWorkerInput | { type: 'STOP' }, 'STOP'>>()
			},
			tags: types<string>()
		},
		actors: {
			fingerprint: createAsyncLogic({
				run: ({ input }: { input: Dataset }) => searchFingerprint(input.documents)
			}),
			read: createAsyncLogic({ run: ({ input }: { input: string }) => cap.read(input) }),
			restore: createAsyncLogic({
				run: async ({ input }: { input: string }) => restoreIndex(input)
			}),
			build: createAsyncLogic({
				run: ({ input }: { input: Dataset }) => buildIndex(input.documents)
			}),
			write: createAsyncLogic({
				run: ({ input }: { input: { key: string; value: CachedIndex } }) =>
					cap.write(input.key, input.value)
			})
		},
		guards: {
			cacheMatches: (
				{ context }: { context: Context },
				params: { cached: CachedIndex | undefined }
			) => params.cached?.fingerprint === context.fingerprint,
			currentQuery: ({
				context,
				event
			}: {
				context: Context
				event: SearchWorkerInput | { type: 'STOP' }
			}) => event.type === 'QUERY' && event.generation === context.dataset?.generation
		}
	})
	return model.createMachine({
		id: 'search-index-worker',
		initial: 'waiting',
		context: { dataset: undefined, fingerprint: '', cached: undefined, index: undefined },
		on: {
			INDEX: (args) => {
				const { event } = args
				return {
					target: '.fingerprinting',
					context: { dataset: event, fingerprint: '', cached: undefined, index: undefined }
				}
			},
			STOP: { target: '.closed' }
		},
		states: {
			waiting: {},
			fingerprinting: {
				invoke: {
					id: 'fingerprint',
					src: 'fingerprint',
					input: ({ context }: { context: Context }) => required(context.dataset),
					onDone: (args) => {
						return { target: 'readingCache', context: { fingerprint: args.event.output } }
					},
					onError: { target: 'failed' }
				}
			},
			readingCache: {
				invoke: {
					id: 'read',
					src: 'read',
					input: ({ context }: { context: Context }) => required(context.dataset).key,
					onDone: (args) => {
						const { event } = args
						if (args.guards.cacheMatches(args, { cached: event.output })) {
							return { target: 'restoring', context: { cached: event.output } }
						}
						return { target: 'building' }
					},
					onError: { target: 'building' }
				}
			},
			restoring: {
				invoke: {
					id: 'restore',
					src: 'restore',
					input: ({ context }: { context: Context }) => required(context.cached).index,
					onDone: (args) => {
						return { target: 'ready', context: { index: args.event.output } }
					},
					onError: { target: 'building' }
				}
			},
			building: {
				invoke: {
					id: 'build',
					src: 'build',
					input: ({ context }: { context: Context }) => required(context.dataset),
					onDone: (args) => {
						return { target: 'persisting', context: { index: args.event.output } }
					},
					onError: { target: 'failed' }
				}
			},
			persisting: {
				invoke: {
					id: 'write',
					src: 'write',
					input: ({ context }: { context: Context }) => ({
						key: required(context.dataset).key,
						value: {
							fingerprint: context.fingerprint,
							index: JSON.stringify(required(context.index))
						}
					}),
					onDone: { target: 'ready' },
					onError: { target: 'ready' }
				}
			},
			ready: {
				entry: ({ context }, enq) => {
					enq(() =>
						cap.report({
							type: 'INDEX_READY',
							generation: required(context.dataset).generation
						})
					)
				},
				on: {
					QUERY: (args, enq) => {
						if (!args.guards.currentQuery(args)) return
						const { event } = args
						enq(() =>
							cap.report({
								type: 'RESULT',
								generation: event.generation,
								query: event.query,
								ids: searchIndex(required(args.context.index), event.query)
							})
						)
					}
				}
			},
			failed: {
				entry: (_args, enq) => {
					enq(() => cap.report({ type: 'WORKER_ERROR' }))
				}
			},
			closed: {
				type: 'final',
				entry: () => {
					return {
						context: { dataset: undefined, fingerprint: '', cached: undefined, index: undefined }
					}
				}
			}
		}
	})
}
