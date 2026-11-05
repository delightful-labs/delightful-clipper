import { assign, fromCallback, fromPromise, sendTo, setup, stateIn } from 'xstate'
import type { ActorRefFrom, SnapshotFrom } from 'xstate'
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
		feedback: fromCallback<{ type: 'UNUSED' }, Library>(({ input, sendBack }) => {
			const subscription = input.subscribe((snapshot) => sendBack({ type: 'LIBRARY', snapshot }))
			sendBack({ type: 'LIBRARY', snapshot: input.getSnapshot() })
			return () => subscription.unsubscribe()
		}),
		read: fromPromise(({ input }: { input: string }) => cap.read(input)),
		extract: fromPromise(({ input, signal }: { input: Source; signal: AbortSignal }) =>
			cap.extract(input, signal)
		),
		issue: fromPromise(({ input }: { input: Capture }) => cap.issue(input, cap.accountId)),
		remove: fromPromise(({ input }: { input: string }) => cap.remove(input)),
		save: fromCallback<{ type: 'CANCEL' }, Context>(({ input, sendBack, receive }) => {
			cap.library.send({
				type: 'ADD',
				url: input.capture!.url,
				...(input.content ? { content: input.content } : {})
			})
			const subscription = cap.library.subscribe((snapshot) =>
				sendBack({ type: 'LIBRARY', snapshot })
			)
			sendBack({ type: 'LIBRARY', snapshot: cap.library.getSnapshot() })
			receive(() => cap.library.send({ type: 'CANCEL' }))
			return () => subscription.unsubscribe()
		})
	}
	const model = setup<
		Context,
		Event,
		typeof actors,
		{},
		{},
		{ stopping: undefined; current: undefined },
		never,
		string,
		{ id: string }
	>({
		actors,
		guards: { stopping: stateIn({ running: { issuing: 'stopping' } }), current: cap.current }
	})
	const message = (key: Parameters<typeof t>[0], variant: WorkflowMessage['variant'] = 'info') =>
		model.assign({ message: (): WorkflowMessage => ({ text: t(key), variant }) })
	const work = model.createStateConfig({
		initial: 'loading',
		states: {
			loading: {
				invoke: {
					src: 'read',
					input: ({ context }) => context.id,
					onDone: [
						{
							guard: ({ event }) => replySchema.safeParse(event.output).success,
							target: 'routing',
							actions: assign(({ event }) => {
								const reply = replySchema.parse(event.output)
								return { capture: reply.capture, source: reply.source }
							})
						},
						{ target: '#extension-clip.unknown' }
					],
					onError: '#extension-clip.unknown'
				}
			},
			routing: {
				always: [
					{
						guard: ({ context }) => context.capture?.phase === 'issued',
						target: '#extension-clip.unknown'
					},
					{ guard: ({ context }) => !!context.source, target: 'extracting' },
					{ target: 'linkOnly' }
				]
			},
			extracting: {
				after: { 15000: 'linkOnly' },
				entry: message('capture.status.pending'),
				on: { SHUTDOWN: '#extension-clip.closed' },
				invoke: {
					src: 'extract',
					input: ({ context }) => context.source!,
					onDone: [
						{
							guard: ({ context, event }) => matchingContent(event.output, context.capture!),
							target: 'ready',
							actions: assign({
								content: ({ event }) => contentSchema.parse(event.output),
								source: undefined
							})
						},
						{ target: 'linkOnly' }
					],
					onError: 'linkOnly'
				}
			},
			ready: {
				always: [{ guard: 'current', target: 'issuing' }, { target: '#extension-clip.closed' }]
			},
			linkOnly: {
				entry: assign({ source: undefined }),
				always: [{ guard: 'current', target: 'issuing' }, { target: '#extension-clip.closed' }]
			},

			issuing: {
				initial: 'active',
				states: { active: { on: { SHUTDOWN: 'stopping' } }, stopping: { on: { SHUTDOWN: {} } } },
				entry: message('capture.status.saving'),
				invoke: {
					src: 'issue',
					input: ({ context }) => context.capture!,
					onDone: [
						{ guard: 'stopping', target: '#extension-clip.closed' },
						{ guard: 'current', target: 'saving' },
						{ target: '#extension-clip.unknown' }
					],
					onError: '#extension-clip.failed'
				}
			},
			saving: {
				initial: 'active',
				states: {
					active: {
						on: { SHUTDOWN: { target: 'stopping', actions: sendTo('save', { type: 'CANCEL' }) } }
					},
					stopping: { on: { SHUTDOWN: {} } }
				},
				invoke: { id: 'save', src: 'save', input: ({ context }) => context },
				on: {
					LIBRARY: [
						{
							guard: ({ event }) => event.snapshot.matches({ running: { capture: 'saved' } }),
							target: 'clearing',
							actions: assign({
								articleId: ({ event }) => event.snapshot.context.captureId,
								message: ({ event }) => selectLibraryView(event.snapshot).captureMessage
							})
						},
						{
							guard: ({ event }) =>
								event.snapshot.matches({ running: { capture: 'uncertain' } }) ||
								event.snapshot.matches({ running: { capture: 'canceled' } }),
							target: '#extension-clip.unknown'
						},
						{
							guard: ({ event }) =>
								event.snapshot.matches({ running: { capture: 'failed' } }) ||
								event.snapshot.status === 'done',
							target: '#extension-clip.failed'
						}
					]
				}
			},
			clearing: {
				on: { SHUTDOWN: {} },
				invoke: {
					src: 'remove',
					input: ({ context }) => context.id,
					onDone: '#extension-clip.saved',
					onError: '#extension-clip.saved'
				}
			}
		}
	})
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
			running: { ...work, on: { SHUTDOWN: '#extension-clip.closed' } },
			saved: {
				invoke: { src: 'feedback', input: () => cap.library },
				on: {
					SHUTDOWN: 'closed',
					LIBRARY: {
						guard: ({ context, event }) => context.articleId === event.snapshot.context.captureId,
						actions: assign({
							message: ({ event }) => selectLibraryView(event.snapshot).captureMessage
						})
					}
				},
				entry: assign({ source: undefined, content: undefined })
			},
			unknown: {
				on: { SHUTDOWN: 'closed' },
				entry: [
					message('capture.status.unknown', 'error'),
					assign({ source: undefined, content: undefined })
				]
			},
			failed: {
				on: { SHUTDOWN: 'closed' },
				entry: [
					message('capture.status.save_failed', 'error'),
					assign({ source: undefined, content: undefined })
				]
			},
			closed: {
				type: 'final',
				entry: assign({ source: undefined, content: undefined, capture: undefined })
			}
		}
	})
}
