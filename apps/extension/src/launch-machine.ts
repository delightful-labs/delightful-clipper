import { assign, fromPromise, setup } from 'xstate'
import { z } from 'zod'
import { sourceUrlSchema, sameSource } from './protocol.js'
import { t } from '../../web/src/lib/localization/index.js'
import type { WorkflowMessage } from '../../web/src/lib/contracts/feedback.js'
import type { Capture } from './protocol.js'
const evidenceSchema = z.object({
	documentId: z.string().min(1).max(128),
	frameId: z.literal(0),
	result: sourceUrlSchema
})
type Tab = Pick<chrome.tabs.Tab, 'id' | 'url'>
type Context = {
	tab: Tab | undefined
	capture: Capture | undefined
	pending: Capture[]
	queued: Tab[]
}
export function createLaunchMachine(cap: {
	inspect: (id: number) => Promise<unknown>
	pending: () => Promise<Capture[]>
	persist: (capture: Capture) => Promise<void>
	show: (capture: Capture, message: WorkflowMessage) => Promise<unknown>
	runtimeExists: () => Promise<boolean>
	createRuntime: () => Promise<void>
	dispatch: (id: string) => Promise<boolean>
	reject: (tab: Tab | undefined, text: string) => Promise<unknown>
	id: () => string
}) {
	const actors = {
		inspect: fromPromise(({ input }: { input: number }) => cap.inspect(input)),
		pending: fromPromise(() => cap.pending()),
		persist: fromPromise(({ input }: { input: Capture }) => cap.persist(input)),
		show: fromPromise(({ input }: { input: Capture }) =>
			cap.show(input, { text: t('capture.status.pending'), variant: 'info' })
		),
		runtimeExists: fromPromise(() => cap.runtimeExists()),
		createRuntime: fromPromise(() => cap.createRuntime()),
		dispatch: fromPromise(({ input }: { input: string }) => cap.dispatch(input)),
		reject: fromPromise(({ input }: { input: Tab | undefined }) =>
			cap.reject(input, t('capture.status.save_failed'))
		),
		uncertain: fromPromise(({ input }: { input: Capture }) =>
			cap.show(input, { text: t('capture.status.unknown'), variant: 'error' })
		),
		failure: fromPromise(({ input }: { input: Capture }) =>
			cap.show(input, { text: t('capture.status.save_failed'), variant: 'error' })
		)
	}
	return setup<Context, { type: 'CLIP'; tab: Tab }, typeof actors>({ actors }).createMachine({
		initial: 'idle',
		context: { tab: undefined, capture: undefined, pending: [], queued: [] },
		on: {
			CLIP: {
				guard: ({ context }) => context.queued.length < 8,
				actions: assign({ queued: ({ context, event }) => [...context.queued, event.tab] })
			}
		},
		states: {
			idle: {
				entry: assign({ tab: undefined, capture: undefined, pending: [] }),
				always: {
					guard: ({ context }) => context.queued.length > 0,
					target: 'admitting',
					actions: assign({
						tab: ({ context }) => context.queued[0],
						queued: ({ context }) => context.queued.slice(1)
					})
				}
			},
			admitting: {
				always: [
					{
						guard: ({ context }) =>
							context.tab?.id !== undefined && sourceUrlSchema.safeParse(context.tab.url).success,
						target: 'inspecting'
					},
					{ target: 'failure' }
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
						{ target: 'failure' }
					],
					onError: 'failure'
				}
			},
			listing: {
				invoke: {
					src: 'pending',
					onDone: { target: 'capacity', actions: assign({ pending: ({ event }) => event.output }) },
					onError: 'failure'
				}
			},
			capacity: {
				always: [
					{ guard: ({ context }) => context.pending.length < 8, target: 'persisting' },
					{ target: 'failure' }
				]
			},
			persisting: {
				invoke: {
					src: 'persist',
					input: ({ context }) => context.capture!,
					onDone: 'showing',
					onError: 'failure'
				}
			},
			showing: {
				invoke: {
					src: 'show',
					input: ({ context }) => context.capture!,
					onDone: 'checkingRuntime',
					onError: 'checkingRuntime'
				}
			},
			checkingRuntime: {
				invoke: {
					src: 'runtimeExists',
					onDone: [
						{ guard: ({ event }) => event.output, target: 'dispatching' },
						{ target: 'creatingRuntime' }
					],
					onError: 'failure'
				}
			},
			creatingRuntime: {
				invoke: { src: 'createRuntime', onDone: 'dispatching', onError: 'failure' }
			},
			dispatching: {
				invoke: {
					src: 'dispatch',
					input: ({ context }) => context.capture!.id,
					onDone: [{ guard: ({ event }) => event.output, target: 'idle' }, { target: 'failure' }],
					onError: 'uncertain'
				}
			},
			uncertain: {
				invoke: {
					src: 'uncertain',
					input: ({ context }) => context.capture!,
					onDone: 'idle',
					onError: 'idle'
				}
			},
			failure: {
				always: [
					{ guard: ({ context }) => !!context.capture, target: 'showingFailure' },
					{ target: 'rejecting' }
				]
			},
			showingFailure: {
				invoke: {
					src: 'failure',
					input: ({ context }) => context.capture!,
					onDone: 'idle',
					onError: 'idle'
				}
			},
			rejecting: {
				invoke: {
					src: 'reject',
					input: ({ context }) => context.tab,
					onDone: 'idle',
					onError: 'idle'
				}
			}
		}
	})
}
