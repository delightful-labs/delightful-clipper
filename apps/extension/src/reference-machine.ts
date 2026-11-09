import type { EventPayload } from '../../web/src/lib/machines/events.js'
import { types, setup, createAsyncLogic } from 'xstate'

import { captureFor, captureSchema, referenceMessageSchema, trustedSender } from './protocol.js'
import type { Capture } from './protocol.js'
type Input = { message: unknown; sender: chrome.runtime.MessageSender }
type Context = Input & { capture: Capture | undefined; accepted: boolean }
export function createReferenceMachine(cap: {
	id: string
	page: string
	read: (id: string) => Promise<unknown>
	write: (capture: Capture) => Promise<void>
	remove: (id: string) => Promise<void>
}) {
	const actors = {
		read: createAsyncLogic({ run: ({ input }: { input: string }) => cap.read(input) }),
		write: createAsyncLogic({ run: ({ input }: { input: Capture }) => cap.write(input) }),
		remove: createAsyncLogic({ run: ({ input }: { input: string }) => cap.remove(input) })
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: { UNUSED: types<EventPayload<{ type: 'UNUSED' }, 'UNUSED'>>() },
			input: types<Input>(),
			output: types<{ accepted: boolean }>(),
			tags: types<string>(),
			children: {
				read: types<import('xstate').ActorRefFrom<(typeof actors)['read']>>(),
				write: types<import('xstate').ActorRefFrom<(typeof actors)['write']>>(),
				remove: types<import('xstate').ActorRefFrom<(typeof actors)['remove']>>()
			}
		},
		actors,
		guards: {
			admitted: ({ context }: { context: Context }) =>
				trustedSender(context.sender, cap.id, cap.page) &&
				referenceMessageSchema.safeParse(context.message).success,
			removalRequested: ({ context }: { context: Context }) =>
				referenceMessageSchema.parse(context.message).type === 'REMOVE'
		}
	})
	return model.createMachine({
		initial: 'admitting',
		context: ({ input }) => ({ ...input, capture: undefined, accepted: false }),
		output: ({ context }) => ({ accepted: context.accepted }),
		states: {
			admitting: {
				type: 'choice',
				choice: (args) => {
					if (args.guards.admitted(args) && args.guards.removalRequested(args)) {
						return { target: 'removing' }
					}
					if (args.guards.admitted(args)) {
						return { target: 'reading' }
					}
					return { target: 'failed' }
				}
			},
			reading: {
				invoke: {
					id: 'read',
					src: 'read',
					input: ({ context }: { context: Context }) =>
						referenceMessageSchema.parse(context.message).id,
					onDone: (args) => {
						const { event } = args
						if (
							captureFor(event.output, referenceMessageSchema.parse(args.context.message).id) &&
							captureSchema.parse(event.output).phase === 'ready'
						) {
							return { target: 'marking', context: { capture: captureSchema.parse(event.output) } }
						}
						return { target: 'failed' }
					},
					onError: { target: 'failed' }
				}
			},
			marking: {
				invoke: {
					id: 'write',
					src: 'write',
					input: ({ context }: { context: Context }) => {
						const message = referenceMessageSchema.parse(context.message)
						if (message.type !== 'ISSUE') throw new Error('invalidResponse')
						return { ...context.capture!, phase: 'issued', accountId: message.accountId }
					},
					onDone: { target: 'done' },
					onError: { target: 'failed' }
				}
			},
			removing: {
				invoke: {
					id: 'remove',
					src: 'remove',
					input: ({ context }: { context: Context }) =>
						referenceMessageSchema.parse(context.message).id,
					onDone: { target: 'done' },
					onError: { target: 'failed' }
				}
			},
			done: {
				type: 'final' as const,
				entry: () => {
					return { context: { accepted: true, capture: undefined, message: undefined } }
				}
			},
			failed: {
				type: 'final' as const,
				entry: () => {
					return { context: { capture: undefined, message: undefined } }
				}
			}
		}
	})
}
