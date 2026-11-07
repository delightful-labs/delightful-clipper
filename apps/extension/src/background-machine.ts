import { assign, fromPromise, setup } from 'xstate'
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
		read: fromPromise(({ input }: { input: string }) => cap.read(input)),
		tab: fromPromise(({ input }: { input: number }) => cap.tab(input)),
		capture: fromPromise(({ input }: { input: Capture }) => cap.capture(input))
	}
	const model = setup<
		Context,
		{ type: 'UNUSED' },
		typeof actors,
		{},
		{},
		{},
		never,
		string,
		Input,
		Reply
	>({ actors }).extend({
		actions: {
			useMetadata: assign({ result: ({ context }): Reply => ({ capture: context.capture! }) })
		},
		guards: {
			matchingCapture: ({ context }, params: { value: unknown }) =>
				captureFor(params.value, messageSchema.parse(context.message).id),
			issuedMatchingCapture: ({ context }, params: { value: unknown }) =>
				captureFor(params.value, messageSchema.parse(context.message).id) &&
				captureSchema.parse(params.value).phase === 'issued',
			matchingTab: ({ context }, params: { tab: chrome.tabs.Tab }) =>
				params.tab.id === context.capture!.tabId &&
				sameSource(params.tab.url, context.capture!.url),
			matchingSource: ({ context }, params: { source: unknown }) =>
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
				always: [
					{
						guard: ({ context }) =>
							trustedSender(context.sender, cap.id, cap.page) &&
							messageSchema.safeParse(context.message).success,
						target: 'reading'
					},
					{ target: 'failed' }
				]
			},
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => messageSchema.parse(context.message).id,
					onDone: [
						{
							guard: {
								type: 'issuedMatchingCapture',
								params: ({ event }) => ({ value: event.output })
							},
							target: 'done',
							actions: [
								assign({ capture: ({ event }) => captureSchema.parse(event.output) }),
								'useMetadata'
							]
						},
						{
							guard: {
								type: 'matchingCapture',
								params: ({ event }) => ({ value: event.output })
							},
							target: 'checkingTab',
							actions: assign({ capture: ({ event }) => captureSchema.parse(event.output) })
						},
						{ target: 'failed' }
					],
					onError: 'failed'
				}
			},
			checkingTab: {
				invoke: {
					src: 'tab',
					input: ({ context }) => context.capture!.tabId,
					onDone: [
						{
							guard: { type: 'matchingTab', params: ({ event }) => ({ tab: event.output }) },
							target: 'capturing',
							actions: assign({ tab: ({ event }) => event.output })
						},
						{ target: 'done', actions: 'useMetadata' }
					],
					onError: { target: 'done', actions: 'useMetadata' }
				}
			},
			capturing: {
				invoke: {
					src: 'capture',
					input: ({ context }) => context.capture!,
					onDone: [
						{
							guard: {
								type: 'matchingSource',
								params: ({ event }) => ({ source: event.output })
							},
							target: 'done',
							actions: assign({
								result: ({ context, event }) => ({
									capture: context.capture!,
									source: sourceSchema.parse(event.output)
								})
							})
						},
						{ target: 'done', actions: 'useMetadata' }
					],
					onError: { target: 'done', actions: 'useMetadata' }
				}
			},
			failed: { type: 'final' },
			done: {
				type: 'final',
				entry: assign({
					message: undefined,
					source: undefined,
					tab: undefined,
					capture: undefined
				})
			}
		}
	})
}
