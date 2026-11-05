import { isPendingArticle } from '../../capture/article-policy.js'
import { assign, fromPromise, setup } from 'xstate'
import type { Article, ArticleContent, SaveArticleRequest } from '../../contracts/articles.js'
import type { QueueCapability } from '../../contracts/article-worker.js'
import { articleId } from '../../capture/source.js'
import type { WorkflowMessage } from '../../contracts/feedback.js'
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
		resolve: fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) =>
			cap.resolve(required(input.current).url, required(input.current).id, signal)
		),
		identify: fromPromise(({ input }: { input: string }) => articleId(cap.libraryId, input)),
		document: fromPromise(({ input, signal }: { input: string; signal: AbortSignal }) =>
			cap.document(input, signal)
		),
		intent: fromPromise(({ input, signal }: { input: string; signal: AbortSignal }) =>
			cap.intent(input, signal)
		),
		extract: fromPromise(({ input, signal }: { input: Context; signal: AbortSignal }) =>
			cap.extract(required(input.current).url, required(input.current).id, signal)
		),
		save: fromPromise(({ input }: { input: SaveArticleRequest }) => cap.save(input)),
		fail: fromPromise(({ input }: { input: Context }) =>
			cap.fail(required(input.current).id, input.failure)
		)
	}
	const input = ({ context }: { context: Context }) => context
	const model = setup<
		Context,
		Event,
		typeof actors,
		{},
		{ problem: undefined },
		{
			isUnknownFailure: undefined
			isSessionFailure: undefined
			isRateLimitedFailure: undefined
			isCanceledFailure: undefined
		}
	>({
		actors,
		guards: {
			isUnknownFailure: ({ context }) => context.failure === 'unknown',
			isSessionFailure: ({ context }) => context.failure === 'sessionUnavailable',
			isRateLimitedFailure: ({ context }) => context.failure === 'rateLimited',
			isCanceledFailure: ({ context }) => context.failure === 'canceled'
		},
		actions: {
			problem: assign({
				failure: ({ event }) =>
					'error' in event && event.error instanceof Error ? event.error.message : 'captureFailed'
			})
		}
	})
	const status = (name: string, variant: WorkflowMessage['variant'], cancelable: boolean) =>
		model.createStateConfig({
			meta: { name, variant },
			entry: ({ context }) =>
				cap.report({
					type: 'STATUS',
					id: required(context.current).id,
					message: { text: name, variant },
					cancelable
				})
		})
	const saveStep = (payload: (args: { context: Context }) => SaveArticleRequest) =>
		model.createStateConfig({
			invoke: {
				src: 'save',
				input: payload,
				onDone: [
					{
						guard: ({ event }) =>
							(event.output.kind === 'saved' || event.output.kind === 'duplicate') &&
							event.output.ready,
						target: 'idle'
					},
					{ target: 'failing', actions: assign({ failure: 'unknown' }) }
				],
				onError: { target: 'failing', actions: 'problem' }
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
			STOP: '.closed',
			ROWS: { actions: assign({ rows: ({ event }) => event.rows }) },
			WAKE: { actions: assign({ seen: {} }) },
			RETRY: {
				actions: assign({
					seen: ({ context, event }) =>
						context.current?.id === event.id
							? context.seen
							: Object.fromEntries(Object.entries(context.seen).filter(([id]) => id !== event.id))
				})
			}
		},
		states: {
			idle: {
				entry: assign({
					current: undefined,
					content: undefined,
					destination: '',
					operationId: '',
					failure: ''
				}),
				always: {
					guard: ({ context }) =>
						context.rows.some((article) => canProcessArticle(article, context.seen)),
					target: 'selecting'
				}
			},
			selecting: {
				entry: assign(({ context }) => {
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
				}),
				always: [
					{ guard: ({ context }) => !context.current, target: 'idle' },
					{ guard: ({ context }) => !!context.current?.operationId, target: 'checkingReserved' },
					{ target: 'resolving' }
				]
			},
			resolving: {
				...status(t('capture.status.pending'), 'info', true),
				on: {
					CANCEL: {
						guard: ({ context, event }) => context.current?.id === event.id,
						target: 'failing',
						actions: assign({ failure: 'canceled' })
					}
				},
				invoke: {
					src: 'resolve',
					input,
					onDone: {
						target: 'identifying',
						actions: assign({ destination: ({ event }) => event.output })
					},
					onError: { target: 'failing', actions: 'problem' }
				}
			},
			identifying: {
				invoke: {
					src: 'identify',
					input: ({ context }) => context.destination,
					onDone: {
						target: 'checkingDocument',
						actions: assign({ operationId: ({ event }) => event.output })
					},
					onError: { target: 'failing', actions: 'problem' }
				}
			},
			checkingReserved: {
				invoke: {
					src: 'document',
					input: ({ context }) => context.operationId,
					onDone: [
						{ guard: ({ event }) => event.output, target: 'saving' },
						{ target: 'failing', actions: assign({ failure: 'unknown' }) }
					],
					onError: { target: 'failing', actions: 'problem' }
				}
			},
			checkingDocument: {
				invoke: {
					src: 'document',
					input: ({ context }) => context.operationId,
					onDone: [
						{ guard: ({ event }) => event.output, target: 'saving' },
						{ target: 'checkingIntent' }
					],
					onError: { target: 'failing', actions: 'problem' }
				}
			},
			checkingIntent: {
				invoke: {
					src: 'intent',
					input: ({ context }) => context.operationId,
					onDone: [
						{
							guard: ({ event }) => event.output,
							target: 'failing',
							actions: assign({ failure: 'unknown' })
						},
						{ guard: ({ context }) => !!context.content, target: 'saving' },
						{ target: 'extracting' }
					],
					onError: { target: 'failing', actions: 'problem' }
				}
			},
			extracting: {
				on: {
					CANCEL: {
						guard: ({ context, event }) => context.current?.id === event.id,
						target: 'failing',
						actions: assign({ failure: 'canceled' })
					}
				},
				invoke: {
					src: 'extract',
					input,
					onDone: {
						target: 'identifying',
						actions: assign({
							destination: ({ event }) => event.output.finalUrl,
							content: ({ event }) => ({
								title: event.output.title,
								text: event.output.text,
								html: event.output.html,
								finalUrl: event.output.finalUrl,
								provenance: event.output.provenance
							})
						})
					},
					onError: { target: 'failing', actions: 'problem' }
				}
			},
			saving: {
				...status(t('capture.status.saving'), 'info', false),
				always: [
					{ guard: ({ context }) => !!context.content, target: 'savingContent' },
					{ target: 'attachingExisting' }
				]
			},
			savingContent: saveStep(({ context }) => ({
				url: required(context.current).url,
				content: required(context.content)
			})),
			attachingExisting: saveStep(({ context }) => ({
				url: required(context.current).url,
				contentId: context.operationId
			})),
			failing: {
				initial: 'deciding',
				states: {
					deciding: {
						always: [
							{ guard: 'isUnknownFailure', target: 'unknown' },
							{ guard: 'isSessionFailure', target: 'sessionUnavailable' },
							{ guard: 'isRateLimitedFailure', target: 'rateLimited' },
							{ guard: 'isCanceledFailure', target: 'canceled' },
							{ target: 'captureFailed' }
						]
					},
					unknown: status(t('capture.status.unknown'), 'error', false),
					sessionUnavailable: status(t('capture.errors.session_unavailable'), 'error', false),
					rateLimited: status(t('capture.errors.rate_limited'), 'error', false),
					canceled: status(t('capture.status.canceled'), 'error', false),
					captureFailed: status(t('capture.status.failed'), 'error', false)
				},
				invoke: { src: 'fail', input, onDone: 'idle', onError: 'idle' }
			},
			closed: {
				type: 'final',
				entry: assign({ rows: [], current: undefined, content: undefined, seen: {} })
			}
		}
	})
}
