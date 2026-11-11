import { types, setup, createAsyncLogic } from 'xstate'

import {
	captureSchema,
	messageSchema,
	sourceSchema,
	trustedSender,
	captureFor,
	sameSource,
	matchingSource
} from './protocol.js'
import type { Capture, Source } from './protocol.js'
type Input = { message: unknown; sender: chrome.runtime.MessageSender }
type Reply = { capture: Capture; source?: Source } | { error: 'captureFailed' }
type Context = Input & {
	capture: Capture | undefined
	tab: chrome.tabs.Tab | undefined
	source: unknown
	result: Reply
}
export function createCaptureReadMachine(cap: {
	id: string
	page: string
	read: (id: string) => Promise<unknown>
	tab: (id: number) => Promise<chrome.tabs.Tab>
	capture: (capture: Capture) => Promise<unknown>
}) {
	const actors = {
		read: createAsyncLogic({ run: ({ input }: { input: string }) => cap.read(input) }),
		tab: createAsyncLogic({ run: ({ input }: { input: number }) => cap.tab(input) }),
		capture: createAsyncLogic({ run: ({ input }: { input: Capture }) => cap.capture(input) })
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {},
			input: types<Input>(),
			output: types<Reply>(),
			tags: types<string>(),
			children: {
				read: types<import('xstate').ActorRefFrom<(typeof actors)['read']>>(),
				tab: types<import('xstate').ActorRefFrom<(typeof actors)['tab']>>(),
				capture: types<import('xstate').ActorRefFrom<(typeof actors)['capture']>>()
			}
		},
		actors,
		actions: {
			useMetadata: ({ context }: { context: Context }) => ({
				context: { result: { capture: context.capture! } }
			})
		},
		guards: {
			matchingCapture: ({ context }: { context: Context }, params: { value: unknown }) =>
				captureFor(params.value, messageSchema.parse(context.message).id),
			issuedMatchingCapture: ({ context }: { context: Context }, params: { value: unknown }) =>
				captureFor(params.value, messageSchema.parse(context.message).id) &&
				captureSchema.parse(params.value).phase === 'issued',
			matchingTab: ({ context }: { context: Context }, params: { tab: chrome.tabs.Tab }) =>
				params.tab.id === context.capture!.tabId &&
				sameSource(params.tab.url, context.capture!.url),
			matchingSource: ({ context }: { context: Context }, params: { source: unknown }) =>
				matchingSource(params.source, context.capture!)
		}
	})
	return model.createMachine({
		initial: 'admitting',
		context: ({ input }) => ({
			...input,
			capture: undefined,
			tab: undefined,
			source: undefined,
			result: { error: 'captureFailed' }
		}),
		output: ({ context }) => context.result,
		states: {
			admitting: {
				type: 'choice',
				choice: (args) => {
					const { context } = args
					if (
						trustedSender(context.sender, cap.id, cap.page) &&
						messageSchema.safeParse(context.message).success
					) {
						return { target: 'reading' }
					}
					return { target: 'failed' }
				}
			},
			reading: {
				invoke: {
					id: 'read',
					src: 'read',
					input: ({ context }: { context: Context }) => messageSchema.parse(context.message).id,
					onDone: (args) => {
						const { event } = args
						if (args.guards.issuedMatchingCapture(args, { value: event.output })) {
							let context = args.context
							let patch = {}
							patch = { ...patch, capture: captureSchema.parse(event.output) }
							context = { ...args.context, ...patch }
							patch = { ...patch, ...args.actions.useMetadata({ ...args, context }).context }
							context = { ...args.context, ...patch }
							return { target: 'done', context: patch }
						}
						if (args.guards.matchingCapture(args, { value: event.output })) {
							return {
								target: 'checkingTab',
								context: { capture: captureSchema.parse(event.output) }
							}
						}
						return { target: 'failed' }
					},
					onError: { target: 'failed' }
				}
			},
			checkingTab: {
				invoke: {
					id: 'tab',
					src: 'tab',
					input: ({ context }: { context: Context }) => context.capture!.tabId,
					onDone: (args) => {
						const { event } = args
						if (args.guards.matchingTab(args, { tab: event.output })) {
							return { target: 'capturing', context: { tab: event.output } }
						}
						return { target: 'done', context: args.actions.useMetadata(args).context }
					},
					onError: (args) => {
						return { target: 'done', context: args.actions.useMetadata(args).context }
					}
				}
			},
			capturing: {
				invoke: {
					id: 'capture',
					src: 'capture',
					input: ({ context }: { context: Context }) => context.capture!,
					onDone: (args) => {
						const { event } = args
						if (args.guards.matchingSource(args, { source: event.output })) {
							return {
								target: 'done',
								context: {
									result: {
										capture: args.context.capture!,
										source: sourceSchema.parse(event.output)
									}
								}
							}
						}
						return { target: 'done', context: args.actions.useMetadata(args).context }
					},
					onError: (args) => {
						return { target: 'done', context: args.actions.useMetadata(args).context }
					}
				}
			},
			failed: { type: 'final' },
			done: {
				type: 'final',
				entry: () => {
					return {
						context: { message: undefined, source: undefined, tab: undefined, capture: undefined }
					}
				}
			}
		}
	})
}
