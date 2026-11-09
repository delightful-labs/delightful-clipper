import type { EventPayload } from '../../web/src/lib/machines/events.js'
import {
	types,
	createCallbackLogic,
	setup,
	createAsyncLogic,
	type ActorRefFrom,
	type SnapshotFrom,
	matchesState
} from 'xstate'

import { z } from 'zod'
import { captureSchema, contentSchema, sourceSchema, matchingContent } from './protocol.js'
import type { Capture, Source } from './protocol.js'
import type { ArticleContent } from '../../web/src/lib/contracts/articles.js'
import { libraryMachine, selectLibraryView } from '../../web/src/lib/machines/capture/library.js'
import { t } from '../../web/src/lib/localization/index.js'
import type { WorkflowMessage } from '../../web/src/lib/contracts/feedback.js'
type Library = ActorRefFrom<typeof libraryMachine>
type Event =
	| { type: 'SHUTDOWN' }
	| { type: 'LIBRARY'; snapshot: SnapshotFrom<typeof libraryMachine> }
type Context = {
	id: string
	capture: Capture | undefined
	source: Source | undefined
	content: ArticleContent | undefined
	articleId: string | undefined
	message: WorkflowMessage | undefined
}
const replySchema = z.object({ capture: captureSchema, source: sourceSchema.optional() })
export type ClipCapability = {
	library: Library
	accountId: string
	current: () => boolean
	read: (id: string) => Promise<unknown>
	extract: (source: Source, signal: AbortSignal) => Promise<unknown>
	issue: (capture: Capture, accountId: string) => Promise<void>
	remove: (id: string) => Promise<void>
}
export function createClipMachine(cap: ClipCapability) {
	const actors = {
		feedback: createCallbackLogic<{ type: 'UNUSED' }, Library>(({ input, sendBack }) => {
			const subscription = input.subscribe((snapshot) =>
				sendBack({ type: 'LIBRARY' as const, snapshot })
			)
			sendBack({ type: 'LIBRARY' as const, snapshot: input.getSnapshot() })
			return () => subscription.unsubscribe()
		}),
		read: createAsyncLogic({ run: ({ input }: { input: string }) => cap.read(input) }),
		extract: createAsyncLogic({
			run: ({ input, signal }: { input: Source; signal: AbortSignal }) => cap.extract(input, signal)
		}),
		issue: createAsyncLogic({
			run: ({ input }: { input: Capture }) => cap.issue(input, cap.accountId)
		}),
		remove: createAsyncLogic({ run: ({ input }: { input: string }) => cap.remove(input) }),
		save: createCallbackLogic<{ type: 'CANCEL' }, Context>(({ input, sendBack, receive }) => {
			cap.library.send({
				type: 'ADD' as const,
				url: input.capture!.url,
				...(input.content ? { content: input.content } : {})
			})
			const subscription = cap.library.subscribe((snapshot) =>
				sendBack({ type: 'LIBRARY' as const, snapshot })
			)
			sendBack({ type: 'LIBRARY' as const, snapshot: cap.library.getSnapshot() })
			receive(() => cap.library.send({ type: 'CANCEL' as const }))
			return () => subscription.unsubscribe()
		})
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				SHUTDOWN: types<EventPayload<Event, 'SHUTDOWN'>>(),
				LIBRARY: types<EventPayload<Event, 'LIBRARY'>>()
			},
			input: types<{ id: string }>(),
			tags: types<string>(),
			children: {
				feedback: types<import('xstate').ActorRefFrom<(typeof actors)['feedback']>>(),
				read: types<import('xstate').ActorRefFrom<(typeof actors)['read']>>(),
				extract: types<import('xstate').ActorRefFrom<(typeof actors)['extract']>>(),
				issue: types<import('xstate').ActorRefFrom<(typeof actors)['issue']>>(),
				remove: types<import('xstate').ActorRefFrom<(typeof actors)['remove']>>(),
				save: types<import('xstate').ActorRefFrom<(typeof actors)['save']>>()
			}
		},
		actors,
		guards: {
			stopping: ({ value }: { value: import('xstate').StateValue }) =>
				matchesState({ running: { issuing: 'stopping' } }, value),
			current: () => cap.current(),
			validReply: (
				_: { context: Context; value: import('xstate').StateValue },
				{ value }: { value: unknown }
			) => replySchema.safeParse(value).success,
			issuedReply: (
				_: { context: Context; value: import('xstate').StateValue },
				{ value }: { value: unknown }
			) =>
				replySchema.safeParse(value).success && replySchema.parse(value).capture.phase === 'issued',
			sourceReply: (
				_: { context: Context; value: import('xstate').StateValue },
				{ value }: { value: unknown }
			) => replySchema.safeParse(value).success && !!replySchema.parse(value).source,
			matchingContent: ({ context }: { context: Context }, { value }: { value: unknown }) =>
				matchingContent(value, context.capture!)
		},
		actions: {
			rememberReply: (
				_: { context: Context; value: import('xstate').StateValue },
				{ value }: { value: unknown }
			) => {
				const reply = replySchema.parse(value)
				return { context: { capture: reply.capture, source: reply.source } }
			}
		}
	})
	const message =
		(key: Parameters<typeof t>[0], variant: WorkflowMessage['variant'] = 'info') =>
		() => ({ context: { message: { text: t(key), variant } } })

	return model.createMachine({
		id: 'extension-clip',
		initial: 'running',
		context: ({ input }) => ({
			...input,
			capture: undefined,
			source: undefined,
			content: undefined,
			message: undefined,
			articleId: undefined
		}),
		states: {
			running: {
				initial: 'loading',
				states: {
					loading: {
						invoke: {
							id: 'read',
							src: 'read',
							input: ({ context }: { context: Context }) => context.id,
							onDone: (args) => {
								const { event } = args
								if (args.guards.issuedReply(args, { value: event.output })) {
									return {
										target: '#extension-clip.unknown',
										context: args.actions.rememberReply(args, { value: event.output }).context
									}
								}
								if (args.guards.sourceReply(args, { value: event.output })) {
									return {
										target: 'extracting',
										context: args.actions.rememberReply(args, { value: event.output }).context
									}
								}
								if (args.guards.validReply(args, { value: event.output })) {
									return {
										target: 'linkOnly',
										context: args.actions.rememberReply(args, { value: event.output }).context
									}
								}
								return { target: '#extension-clip.unknown' }
							},
							onError: { target: '#extension-clip.unknown' }
						}
					},
					extracting: {
						after: { 15000: { target: 'linkOnly' } },
						entry: message('capture.status.pending'),
						on: { SHUTDOWN: { target: '#extension-clip.closed' } },
						invoke: {
							id: 'extract',
							src: 'extract',
							input: ({ context }: { context: Context }) => context.source!,
							onDone: (args) => {
								const { event } = args
								if (!args.guards.current()) {
									return { target: '#extension-clip.closed' }
								}
								if (args.guards.matchingContent(args, { value: event.output })) {
									return {
										target: 'issuing',
										context: { content: contentSchema.parse(event.output), source: undefined }
									}
								}
								return { target: 'linkOnly' }
							},
							onError: { target: 'linkOnly' }
						}
					},
					linkOnly: {
						entry: () => {
							return { context: { source: undefined } }
						},
						always: (args) => {
							if (args.guards.current()) {
								return { target: 'issuing' }
							}
							return { target: '#extension-clip.closed' }
						}
					},

					issuing: {
						initial: 'active',
						states: {
							active: { on: { SHUTDOWN: { target: 'stopping' } } },
							stopping: { on: { SHUTDOWN: {} } }
						},
						entry: message('capture.status.saving'),
						invoke: {
							id: 'issue',
							src: 'issue',
							input: ({ context }: { context: Context }) => context.capture!,
							onDone: (args) => {
								if (args.guards.stopping(args)) {
									return { target: '#extension-clip.closed' }
								}
								if (args.guards.current()) {
									return { target: 'saving' }
								}
								return { target: '#extension-clip.unknown' }
							},
							onError: { target: '#extension-clip.failed' }
						}
					},
					saving: {
						initial: 'active',
						states: {
							active: {
								on: {
									SHUTDOWN: (args, enq) => {
										enq.sendTo('save', { type: 'CANCEL' as const })
										return { target: 'stopping' }
									}
								}
							},
							stopping: { on: { SHUTDOWN: {} } }
						},
						invoke: {
							id: 'save',
							src: 'save',
							input: ({ context }: { context: Context }) => context
						},
						on: {
							LIBRARY: (args) => {
								const { event } = args
								if (event.snapshot.matches({ running: { capture: 'saved' } })) {
									return {
										target: 'clearing',
										context: {
											articleId: event.snapshot.context.captureId,
											message: selectLibraryView(event.snapshot).captureMessage
										}
									}
								}
								if (
									event.snapshot.matches({ running: { capture: 'uncertain' } }) ||
									event.snapshot.matches({ running: { capture: 'canceled' } })
								) {
									return { target: '#extension-clip.unknown' }
								}
								if (
									event.snapshot.matches({ running: { capture: 'failed' } }) ||
									event.snapshot.status === 'done'
								) {
									return { target: '#extension-clip.failed' }
								}
							}
						}
					},
					clearing: {
						on: { SHUTDOWN: {} },
						invoke: {
							id: 'remove',
							src: 'remove',
							input: ({ context }: { context: Context }) => context.id,
							onDone: { target: '#extension-clip.saved' },
							onError: { target: '#extension-clip.saved' }
						}
					}
				},
				on: { SHUTDOWN: { target: '#extension-clip.closed' } }
			},
			saved: {
				invoke: { id: 'feedback', src: 'feedback', input: () => cap.library },
				on: {
					SHUTDOWN: { target: 'closed' },
					LIBRARY: (args) => {
						const { event } = args
						if (!(args.context.articleId === event.snapshot.context.captureId)) return
						return { context: { message: selectLibraryView(event.snapshot).captureMessage } }
					}
				},
				entry: () => {
					return { context: { source: undefined, content: undefined } }
				}
			},
			unknown: {
				on: { SHUTDOWN: { target: 'closed' } },
				entry: () => ({
					context: {
						...message('capture.status.unknown', 'error')().context,
						source: undefined,
						content: undefined
					}
				})
			},
			failed: {
				on: { SHUTDOWN: { target: 'closed' } },
				entry: () => ({
					context: {
						...message('capture.status.save_failed', 'error')().context,
						source: undefined,
						content: undefined
					}
				})
			},
			closed: {
				type: 'final' as const,
				entry: () => {
					return { context: { source: undefined, content: undefined, capture: undefined } }
				}
			}
		}
	})
}
