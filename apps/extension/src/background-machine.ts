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
	return setup<Context, { type: 'UNUSED' }, typeof actors, {}, {}, {}, never, string, Input, Reply>(
		{ actors }
	).createMachine({
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
							guard: ({ context, event }) =>
								captureFor(event.output, messageSchema.parse(context.message).id),
							target: 'routing',
							actions: assign({ capture: ({ event }) => captureSchema.parse(event.output) })
						},
						{ target: 'failed' }
					],
					onError: 'failed'
				}
			},
			routing: {
				always: [
					{ guard: ({ context }) => context.capture?.phase === 'issued', target: 'metadata' },
					{ target: 'checkingTab' }
				]
			},
			checkingTab: {
				invoke: {
					src: 'tab',
					input: ({ context }) => context.capture!.tabId,
					onDone: {
						target: 'checkingSource',
						actions: assign({ tab: ({ event }) => event.output })
					},
					onError: 'metadata'
				}
			},
			checkingSource: {
				always: [
					{
						guard: ({ context }) =>
							context.tab?.id === context.capture!.tabId &&
							sameSource(context.tab?.url, context.capture!.url),
						target: 'capturing'
					},
					{ target: 'metadata' }
				]
			},
			capturing: {
				invoke: {
					src: 'capture',
					input: ({ context }) => context.capture!,
					onDone: {
						target: 'validating',
						actions: assign({ source: ({ event }) => event.output })
					},
					onError: 'metadata'
				}
			},
			validating: {
				always: [
					{
						guard: ({ context }) => matchingSource(context.source, context.capture!),
						target: 'done',
						actions: assign({
							result: ({ context }) => ({
								capture: context.capture!,
								source: sourceSchema.parse(context.source)
							})
						})
					},
					{ target: 'metadata' }
				]
			},
			metadata: {
				entry: assign({ result: ({ context }) => ({ capture: context.capture! }) }),
				always: 'done'
			},
			failed: { type: 'final' },
			done: {
				type: 'final',
				entry: assign({ message: undefined, source: undefined, tab: undefined, capture: undefined })
			}
		}
	})
}
