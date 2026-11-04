import { assign, fromPromise, setup } from 'xstate'
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
	const model = setup<Context, Event, typeof actors, {}, { problem: undefined }>({
		actors,
		actions: {
			problem: assign({
				failure: ({ event }) =>
					'error' in event && event.error instanceof Error ? event.error.message : 'captureFailed'
			})
		}
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
						context.rows.some(
							(r) => !r.contentId && !context.seen[r.id] && (!r.failure || transient.has(r.failure))
						),
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
						.find(
							(r) => !r.contentId && !context.seen[r.id] && (!r.failure || transient.has(r.failure))
						)
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
				entry: ({ context }) =>
					cap.report({
						type: 'STATUS',
						id: required(context.current).id,
						message: { text: t('capture.status.pending'), variant: 'info' },
						cancelable: true
					}),
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
				entry: ({ context }) =>
					cap.report({
						type: 'STATUS',
						id: required(context.current).id,
						message: { text: t('capture.status.saving'), variant: 'info' },
						cancelable: false
					}),
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
				entry: ({ context }) =>
					cap.report({
						type: 'STATUS',
						id: required(context.current).id,
						message: {
							text: t(
								context.failure === 'unknown'
									? 'capture.status.unknown'
									: context.failure === 'sessionUnavailable'
										? 'capture.errors.session_unavailable'
										: context.failure === 'rateLimited'
											? 'capture.errors.rate_limited'
											: context.failure === 'canceled'
												? 'capture.status.canceled'
												: 'capture.status.failed'
							),
							variant: 'error'
						},
						cancelable: false
					}),
				invoke: { src: 'fail', input, onDone: 'idle', onError: 'idle' }
			},
			closed: {
				type: 'final',
				entry: assign({ rows: [], current: undefined, content: undefined, seen: {} })
			}
		}
	})
}
