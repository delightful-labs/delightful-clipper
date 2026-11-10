import { articleMetadataSchema } from '../../capture/metadata.js'
import type { EventPayload } from '../events.js'
import { types, setup, createAsyncLogic } from 'xstate'
import { isPendingArticle } from '../../capture/article-policy.js'

import type { Article, ArticleContent, SaveArticleRequest } from '../../contracts/articles.js'
import type { QueueCapability } from '../../contracts/article-worker.js'
import { articleId } from '../../capture/source.js'

import { t } from '../../localization/index.js'
const transient = new Set([
	'networkUnavailable',
	'fetchTimeout',
	'sourceUnavailable',
	'captureFailed',
	'gatewayUnavailable',
	'rateLimited'
])
type Context = {
	rows: Article[]
	current: Article | undefined
	destination: string
	operationId: string
	content: ArticleContent | undefined
	seen: Record<string, true>
	failure: string
}
function canProcessArticle(article: Article, seen: Context['seen']) {
	if (!isPendingArticle(article)) return false
	if (seen[article.id]) return false
	return !article.failure || transient.has(article.failure)
}
type Event =
	| { type: 'ROWS'; rows: Article[] }
	| { type: 'STOP' | 'WAKE' }
	| { type: 'CANCEL' | 'RETRY'; id: string }
function required<T>(v: T | undefined): T {
	if (v === undefined) throw new Error('Missing queued article')
	return v
}
/** Runs inside a dedicated module worker. Selection and every capture transition live here. */
export function createArticleQueueMachine(cap: QueueCapability) {
	const actors = {
		resolve: createAsyncLogic({
			run: ({ input, signal }: { input: Context; signal: AbortSignal }) =>
				cap.resolve(required(input.current).url, required(input.current).id, signal)
		}),
		identify: createAsyncLogic({
			run: ({ input }: { input: string }) => articleId(cap.libraryId, input)
		}),
		document: createAsyncLogic({
			run: ({ input, signal }: { input: string; signal: AbortSignal }) =>
				cap.document(input, signal)
		}),
		intent: createAsyncLogic({
			run: ({ input, signal }: { input: string; signal: AbortSignal }) => cap.intent(input, signal)
		}),
		extract: createAsyncLogic({
			run: ({ input, signal }: { input: Context; signal: AbortSignal }) =>
				cap.extract(required(input.current).url, required(input.current).id, signal)
		}),
		save: createAsyncLogic({ run: ({ input }: { input: SaveArticleRequest }) => cap.save(input) }),
		fail: createAsyncLogic({
			run: ({ input }: { input: Context }) => cap.fail(required(input.current).id, input.failure)
		})
	}
	const input = ({ context }: { context: Context }) => context
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
				ROWS: types<EventPayload<Event, 'ROWS'>>(),
				STOP: types<EventPayload<Event, 'STOP'>>(),
				WAKE: types<EventPayload<Event, 'WAKE'>>(),
				RETRY: types<EventPayload<Event, 'RETRY'>>(),
				CANCEL: types<EventPayload<Event, 'CANCEL'>>()
			},
			children: {
				resolve: types<import('xstate').ActorRefFrom<(typeof actors)['resolve']>>(),
				identify: types<import('xstate').ActorRefFrom<(typeof actors)['identify']>>(),
				document: types<import('xstate').ActorRefFrom<(typeof actors)['document']>>(),
				intent: types<import('xstate').ActorRefFrom<(typeof actors)['intent']>>(),
				extract: types<import('xstate').ActorRefFrom<(typeof actors)['extract']>>(),
				save: types<import('xstate').ActorRefFrom<(typeof actors)['save']>>(),
				fail: types<import('xstate').ActorRefFrom<(typeof actors)['fail']>>()
			}
		},
		actors,
		guards: {
			isUnknownFailure: ({ context }: { context: Context }) => context.failure === 'unknown',
			isSessionFailure: ({ context }: { context: Context }) =>
				context.failure === 'sessionUnavailable',
			isRateLimitedFailure: ({ context }: { context: Context }) =>
				context.failure === 'rateLimited',
			isCanceledFailure: ({ context }: { context: Context }) => context.failure === 'canceled'
		},
		actions: {
			problem: ({ event }: { event: { type: string; error?: unknown } }) => ({
				context: {
					failure:
						'error' in event && event.error instanceof Error ? event.error.message : 'captureFailed'
				}
			})
		}
	})

	return model.createMachine({
		id: 'article-queue',
		initial: 'idle',
		context: {
			rows: [],
			current: undefined,
			destination: '',
			operationId: '',
			content: undefined,
			seen: {},
			failure: ''
		},
		on: {
			STOP: { target: '.closed' },
			ROWS: (args) => {
				return { context: { rows: args.event.rows } }
			},
			WAKE: () => {
				return { context: { seen: {} } }
			},
			RETRY: (args) => {
				const { context, event } = args
				return {
					context: {
						seen:
							context.current?.id === event.id
								? context.seen
								: Object.fromEntries(Object.entries(context.seen).filter(([id]) => id !== event.id))
					}
				}
			}
		},
		states: {
			idle: {
				entry: () => {
					return {
						context: {
							current: undefined,
							content: undefined,
							destination: '',
							operationId: '',
							failure: ''
						}
					}
				},
				always: (args) => {
					const { context } = args
					if (!context.rows.some((article) => canProcessArticle(article, context.seen))) return
					return { target: 'selecting' }
				}
			},
			selecting: {
				entry: (args) => {
					return {
						context: (({ context }) => {
							const current = [...context.rows]
								.sort(
									(a, b) =>
										a.originalSavedAt.localeCompare(b.originalSavedAt) || a.id.localeCompare(b.id)
								)
								.find((article) => canProcessArticle(article, context.seen))
							return {
								current,
								seen: current ? { ...context.seen, [current.id]: true } : context.seen,
								operationId: current?.operationId ?? ''
							}
						})(args)
					}
				},
				always: (args) => {
					const { context } = args
					if (!context.current) {
						return { target: 'idle' }
					}
					if (context.current?.operationId) {
						return { target: 'checkingReserved' }
					}
					return { target: 'resolving' }
				}
			},
			resolving: {
				meta: {
					name: t('capture.status.pending'),
					variant: 'info'
				},
				entry: ({ context }, enq) => {
					enq(() =>
						cap.report({
							type: 'STATUS',
							id: required(context.current).id,
							message: {
								text: t('capture.status.pending'),
								variant: 'info'
							},
							cancelable: true
						})
					)
				},
				on: {
					CANCEL: (args) => {
						if (!(args.context.current?.id === args.event.id)) return
						return {
							target: 'failing',
							context: { failure: 'canceled' }
						}
					}
				},
				invoke: {
					id: 'resolve',
					src: 'resolve',
					input,
					onDone: (args) => {
						return {
							target: 'identifying',
							context: { destination: args.event.output }
						}
					},
					onError: (args) => {
						return {
							target: 'failing',
							context: args.actions.problem(args).context
						}
					}
				}
			},
			identifying: {
				invoke: {
					id: 'identify',
					src: 'identify',
					input: ({ context }: { context: Context }) => context.destination,
					onDone: (args) => {
						return { target: 'checkingDocument', context: { operationId: args.event.output } }
					},
					onError: (args) => {
						return { target: 'failing', context: args.actions.problem(args).context }
					}
				}
			},
			checkingReserved: {
				invoke: {
					id: 'document',
					src: 'document',
					input: ({ context }: { context: Context }) => context.operationId,
					onDone: (args) => {
						if (args.event.output) {
							return { target: 'saving' }
						}
						return { target: 'failing', context: { failure: 'unknown' } }
					},
					onError: (args) => {
						return { target: 'failing', context: args.actions.problem(args).context }
					}
				}
			},
			checkingDocument: {
				invoke: {
					id: 'document',
					src: 'document',
					input: ({ context }: { context: Context }) => context.operationId,
					onDone: (args) => {
						if (args.event.output) {
							return { target: 'saving' }
						}
						return { target: 'checkingIntent' }
					},
					onError: (args) => {
						return { target: 'failing', context: args.actions.problem(args).context }
					}
				}
			},
			checkingIntent: {
				invoke: {
					id: 'intent',
					src: 'intent',
					input: ({ context }: { context: Context }) => context.operationId,
					onDone: (args) => {
						if (args.event.output) {
							return { target: 'failing', context: { failure: 'unknown' } }
						}
						if (args.context.content) {
							return { target: 'saving' }
						}
						return { target: 'extracting' }
					},
					onError: (args) => {
						return { target: 'failing', context: args.actions.problem(args).context }
					}
				}
			},
			extracting: {
				on: {
					CANCEL: (args) => {
						if (!(args.context.current?.id === args.event.id)) return
						return { target: 'failing', context: { failure: 'canceled' } }
					}
				},
				invoke: {
					id: 'extract',
					src: 'extract',
					input,
					onDone: (args) => {
						const { event } = args
						return {
							target: 'identifying',
							context: {
								destination: event.output.finalUrl,
								content: {
									title: event.output.title,
									...articleMetadataSchema.parse(event.output),
									text: event.output.text,
									html: event.output.html,
									finalUrl: event.output.finalUrl,
									provenance: event.output.provenance
								}
							}
						}
					},
					onError: (args) => {
						return { target: 'failing', context: args.actions.problem(args).context }
					}
				}
			},
			saving: {
				meta: {
					name: t('capture.status.saving'),
					variant: 'info'
				},
				entry: ({ context }, enq) => {
					enq(() =>
						cap.report({
							type: 'STATUS',
							id: required(context.current).id,
							message: {
								text: t('capture.status.saving'),
								variant: 'info'
							},
							cancelable: false
						})
					)
				},
				always: (args) => {
					if (args.context.content) {
						return { target: 'savingContent' }
					}
					return { target: 'attachingExisting' }
				}
			},
			savingContent: {
				invoke: {
					id: 'save',
					src: 'save',
					input: ({ context }) => ({
						url: required(context.current).url,
						content: required(context.content)
					}),
					onDone: (args) => {
						const { event } = args
						if (
							(event.output.kind === 'saved' || event.output.kind === 'duplicate') &&
							event.output.ready
						) {
							return { target: 'idle' }
						}
						return { target: 'failing', context: { failure: 'unknown' } }
					},
					onError: (args) => {
						return { target: 'failing', context: args.actions.problem(args).context }
					}
				}
			},
			attachingExisting: {
				invoke: {
					id: 'save',
					src: 'save',
					input: ({ context }) => ({
						url: required(context.current).url,
						contentId: context.operationId
					}),
					onDone: (args) => {
						const { event } = args
						if (
							(event.output.kind === 'saved' || event.output.kind === 'duplicate') &&
							event.output.ready
						) {
							return { target: 'idle' }
						}
						return { target: 'failing', context: { failure: 'unknown' } }
					},
					onError: (args) => {
						return { target: 'failing', context: args.actions.problem(args).context }
					}
				}
			},
			failing: {
				initial: 'deciding',
				states: {
					deciding: {
						type: 'choice',
						choice: (args) => {
							if (args.guards.isUnknownFailure(args)) {
								return { target: 'unknown' }
							}
							if (args.guards.isSessionFailure(args)) {
								return { target: 'sessionUnavailable' }
							}
							if (args.guards.isRateLimitedFailure(args)) {
								return { target: 'rateLimited' }
							}
							if (args.guards.isCanceledFailure(args)) {
								return { target: 'canceled' }
							}
							return { target: 'captureFailed' }
						}
					},
					unknown: {
						meta: { name: t('capture.status.unknown'), variant: 'error' },
						entry: ({ context }, enq) => {
							enq(() =>
								cap.report({
									type: 'STATUS',
									id: required(context.current).id,
									message: { text: t('capture.status.unknown'), variant: 'error' },
									cancelable: false
								})
							)
						}
					},
					sessionUnavailable: {
						meta: { name: t('capture.errors.session_unavailable'), variant: 'error' },
						entry: ({ context }, enq) => {
							enq(() =>
								cap.report({
									type: 'STATUS',
									id: required(context.current).id,
									message: { text: t('capture.errors.session_unavailable'), variant: 'error' },
									cancelable: false
								})
							)
						}
					},
					rateLimited: {
						meta: { name: t('capture.errors.rate_limited'), variant: 'error' },
						entry: ({ context }, enq) => {
							enq(() =>
								cap.report({
									type: 'STATUS',
									id: required(context.current).id,
									message: { text: t('capture.errors.rate_limited'), variant: 'error' },
									cancelable: false
								})
							)
						}
					},
					canceled: {
						meta: { name: t('capture.status.canceled'), variant: 'error' },
						entry: ({ context }, enq) => {
							enq(() =>
								cap.report({
									type: 'STATUS',
									id: required(context.current).id,
									message: { text: t('capture.status.canceled'), variant: 'error' },
									cancelable: false
								})
							)
						}
					},
					captureFailed: {
						meta: { name: t('capture.status.failed'), variant: 'error' },
						entry: ({ context }, enq) => {
							enq(() =>
								cap.report({
									type: 'STATUS',
									id: required(context.current).id,
									message: { text: t('capture.status.failed'), variant: 'error' },
									cancelable: false
								})
							)
						}
					}
				},
				invoke: {
					id: 'fail',
					src: 'fail',
					input,
					onDone: { target: 'idle' },
					onError: { target: 'idle' }
				}
			},
			closed: {
				type: 'final',
				entry: () => {
					return { context: { rows: [], current: undefined, content: undefined, seen: {} } }
				}
			}
		}
	})
}
