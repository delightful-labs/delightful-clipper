import { and, assign, fromPromise, setup } from 'xstate'
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
		read: fromPromise(({ input }: { input: string }) => cap.read(input)),
		write: fromPromise(({ input }: { input: Capture }) => cap.write(input)),
		remove: fromPromise(({ input }: { input: string }) => cap.remove(input))
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
		{ accepted: boolean }
	>({ actors }).extend({
		guards: {
			admitted: ({ context }) =>
				trustedSender(context.sender, cap.id, cap.page) &&
				referenceMessageSchema.safeParse(context.message).success,
			removalRequested: ({ context }) =>
				referenceMessageSchema.parse(context.message).type === 'REMOVE'
		}
	})
	return model.createMachine({
		initial: 'admitting',
		context: ({ input }) => ({ ...input, capture: undefined, accepted: false }),
		output: ({ context }) => ({ accepted: context.accepted }),
		states: {
			admitting: {
				always: [
					{ guard: and(['admitted', 'removalRequested']), target: 'removing' },
					{ guard: 'admitted', target: 'reading' },
					{ target: 'failed' }
				]
			},
			reading: {
				invoke: {
					src: 'read',
					input: ({ context }) => referenceMessageSchema.parse(context.message).id,
					onDone: [
						{
							guard: ({ context, event }) =>
								captureFor(event.output, referenceMessageSchema.parse(context.message).id) &&
								captureSchema.parse(event.output).phase === 'ready',
							target: 'marking',
							actions: assign({ capture: ({ event }) => captureSchema.parse(event.output) })
						},
						{ target: 'failed' }
					],
					onError: 'failed'
				}
			},
			marking: {
				invoke: {
					src: 'write',
					input: ({ context }) => {
						const message = referenceMessageSchema.parse(context.message)
						if (message.type !== 'ISSUE') throw new Error('invalidResponse')
						return { ...context.capture!, phase: 'issued', accountId: message.accountId }
					},
					onDone: 'done',
					onError: 'failed'
				}
			},
			removing: {
				invoke: {
					src: 'remove',
					input: ({ context }) => referenceMessageSchema.parse(context.message).id,
					onDone: 'done',
					onError: 'failed'
				}
			},
			done: {
				type: 'final',
				entry: assign({ accepted: true, capture: undefined, message: undefined })
			},
			failed: { type: 'final', entry: assign({ capture: undefined, message: undefined }) }
		}
	})
}
