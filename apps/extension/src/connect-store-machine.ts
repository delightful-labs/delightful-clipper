import { assign, fromPromise, setup } from 'xstate'
import { connectMessageSchema, trustedAccountPage } from './protocol.js'
import type { Connection, ConnectionScope } from './connection.js'
type Input = { message: unknown; sender: chrome.runtime.MessageSender }
type Context = Input & { connection: Connection | undefined; accepted: boolean }
export function createConnectStoreMachine(cap: {
	id: string
	pages: string[]
	scope: ConnectionScope
	idForConfirmation: () => string
	write: (connection: Connection) => Promise<void>
	notify: (accountId: string) => Promise<unknown>
}) {
	const actors = {
		write: fromPromise(({ input }: { input: Connection }) => cap.write(input)),
		notify: fromPromise(({ input }: { input: string }) => cap.notify(input))
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
		context: ({ input }) => ({ ...input, connection: undefined, accepted: false }),
		output: ({ context }) => ({ accepted: context.accepted }),
		states: {
			admitting: {
				always: [
					{
						guard: ({ context }) =>
							trustedAccountPage(context.sender, cap.id, cap.pages) &&
							connectMessageSchema.safeParse(context.message).success,
						target: 'persisting',
						actions: assign({
							connection: ({ context }) => {
								const { accountId, requestId } = connectMessageSchema.parse(context.message)
								return {
									...cap.scope,
									version: 1 as const,
									confirmationId: cap.idForConfirmation(),
									accountId,
									...(requestId ? { requestId } : {})
								}
							}
						})
					},
					{ target: 'failed' }
				]
			},
			persisting: {
				invoke: {
					src: 'write',
					input: ({ context }) => context.connection!,
					onDone: 'notifying',
					onError: 'failed'
				}
			},
			notifying: {
				invoke: {
					src: 'notify',
					input: ({ context }) => context.connection!.accountId,
					onDone: 'done',
					onError: 'done'
				}
			},
			done: {
				type: 'final',
				entry: assign({ accepted: true, connection: undefined, message: undefined })
			},
			failed: { type: 'final', entry: assign({ connection: undefined, message: undefined }) }
		}
	})
}
