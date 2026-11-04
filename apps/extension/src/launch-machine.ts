import { assign, fromPromise, setup } from 'xstate'
import { z } from 'zod'
import { sourceUrlSchema, sameSource } from './protocol.js'
import type { Capture } from './protocol.js'
const evidenceSchema = z.object({
	documentId: z.string().min(1).max(128),
	frameId: z.literal(0),
	result: sourceUrlSchema
})
type Tab = Pick<chrome.tabs.Tab, 'id' | 'url'>
type Context = { tab: Tab | undefined; capture: Capture | undefined; pending: Capture[] }
export function createLaunchMachine(cap: {
	inspect: (id: number) => Promise<unknown>
	pending: () => Promise<Capture[]>
	persist: (capture: Capture) => Promise<void>
	open: (id: string) => Promise<unknown>
	id: () => string
}) {
	const actors = {
		inspect: fromPromise(({ input }: { input: number }) => cap.inspect(input)),
		pending: fromPromise(() => cap.pending()),
		persist: fromPromise(({ input }: { input: Capture }) => cap.persist(input)),
		open: fromPromise(({ input }: { input: string }) => cap.open(input))
	}
	return setup<Context, { type: 'CLIP'; tab: Tab }, typeof actors>({ actors }).createMachine({
		initial: 'idle',
		context: { tab: undefined, capture: undefined, pending: [] },
		states: {
			idle: {
				entry: assign({ tab: undefined, capture: undefined, pending: [] }),
				on: { CLIP: { target: 'admitting', actions: assign({ tab: ({ event }) => event.tab }) } }
			},
			admitting: {
				always: [
					{
						guard: ({ context }) =>
							context.tab?.id !== undefined && sourceUrlSchema.safeParse(context.tab.url).success,
						target: 'inspecting'
					},
					{ target: 'openingFailure' }
				]
			},
			inspecting: {
				invoke: {
					src: 'inspect',
					input: ({ context }) => context.tab!.id!,
					onDone: [
						{
							guard: ({ context, event }) => {
								const parsed = evidenceSchema.safeParse(event.output)
								return parsed.success && sameSource(parsed.data.result, context.tab!.url!)
							},
							target: 'listing',
							actions: assign({
								capture: ({ context, event }) => {
									const evidence = evidenceSchema.parse(event.output)
									return {
										version: 1,
										id: cap.id(),
										tabId: context.tab!.id!,
										documentId: evidence.documentId,
										url: evidence.result,
										phase: 'ready'
									}
								}
							})
						},
						{ target: 'openingFailure' }
					],
					onError: 'openingFailure'
				}
			},
			listing: {
				invoke: {
					src: 'pending',
					onDone: { target: 'capacity', actions: assign({ pending: ({ event }) => event.output }) },
					onError: 'openingFailure'
				}
			},
			capacity: {
				always: [
					{ guard: ({ context }) => context.pending.length < 8, target: 'persisting' },
					{ target: 'recovering' }
				]
			},
			recovering: {
				entry: assign({ capture: ({ context }) => context.pending[0] }),
				always: 'opening'
			},
			persisting: {
				invoke: {
					src: 'persist',
					input: ({ context }) => context.capture!,
					onDone: 'opening',
					onError: 'openingFailure'
				}
			},
			opening: {
				invoke: {
					src: 'open',
					input: ({ context }) => context.capture!.id,
					onDone: 'idle',
					onError: 'idle'
				}
			},
			openingFailure: { invoke: { src: 'open', input: () => '', onDone: 'idle', onError: 'idle' } }
		}
	})
}
