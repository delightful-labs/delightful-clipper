import { assign, fromPromise, setup } from 'xstate'
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
	return setup<
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
	>({ actors }).createMachine({
		initial: 'admitting',
		context: ({ input }) => ({ ...input, capture: undefined, accepted: false }),
		output: ({ context }) => ({ accepted: context.accepted }),
		states: {
			admitting: {
				always: [
					{
						guard: ({ context }) =>
							trustedSender(context.sender, cap.id, cap.page) &&
							referenceMessageSchema.safeParse(context.message).success,
						target: 'routing'
					},
					{ target: 'failed' }
				]
			},
			routing: {
				always: [
					{
						guard: ({ context }) => referenceMessageSchema.parse(context.message).type === 'REMOVE',
						target: 'removing'
					},
					{ target: 'reading' }
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
