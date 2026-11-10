import { types, setup, createAsyncLogic, createCallbackLogic } from 'xstate'

import { connectMessageSchema, trustedAccountPage } from './protocol.js'
import type { Connection, ConnectionScope } from './connection.js'
type Input = { message: unknown; sender: chrome.runtime.MessageSender }
type PendingConnection = Omit<Connection, 'confirmationId'>
type Context = Input & {
	pendingConnection: PendingConnection | undefined
	connection: Connection | undefined
	accepted: boolean
}
export function createConnectStoreMachine(cap: {
	id: string
	pages: string[]
	scope: ConnectionScope
	idForConfirmation: () => string
	write: (connection: Connection) => Promise<void>
	notify: (accountId: string) => Promise<unknown>
}) {
	const actors = {
		confirmation: createCallbackLogic<never, PendingConnection>(({ input, sendBack }) => {
			sendBack({
				type: 'CONFIRMATION_ISSUED',
				connection: { ...input, confirmationId: cap.idForConfirmation() }
			})
		}),
		write: createAsyncLogic({ run: ({ input }: { input: Connection }) => cap.write(input) }),
		notify: createAsyncLogic({ run: ({ input }: { input: string }) => cap.notify(input) })
	}
	return setup({
		schemas: {
			context: types<Context>(),
			events: {
				CONFIRMATION_ISSUED: types<{ connection: Connection }>()
			},
			input: types<Input>(),
			output: types<{ accepted: boolean }>(),
			tags: types<string>(),
			children: {
				confirmation: types<import('xstate').ActorRefFrom<typeof actors.confirmation>>(),
				write: types<import('xstate').ActorRefFrom<(typeof actors)['write']>>(),
				notify: types<import('xstate').ActorRefFrom<(typeof actors)['notify']>>()
			}
		},
		actors
	}).createMachine({
		id: 'extension-connection-store',
		initial: 'admitting',
		context: ({ input }) => ({
			...input,
			connection: undefined,
			pendingConnection: undefined,
			accepted: false
		}),
		output: ({ context }) => ({ accepted: context.accepted }),
		states: {
			admitting: {
				always: (args) => {
					const { context } = args
					if (
						trustedAccountPage(context.sender, cap.id, cap.pages) &&
						connectMessageSchema.safeParse(context.message).success
					) {
						return {
							target: 'confirming',
							context: {
								pendingConnection: (({ context }) => {
									const { accountId, requestId } = connectMessageSchema.parse(context.message)
									return {
										...cap.scope,
										version: 1,
										accountId,
										...(requestId ? { requestId } : {})
									}
								})(args)
							}
						}
					}
					return { target: 'failed' }
				}
			},
			confirming: {
				invoke: {
					id: 'confirmation',
					src: 'confirmation',
					input: ({ context }) => context.pendingConnection!,
					onError: { target: 'failed' }
				},
				on: {
					CONFIRMATION_ISSUED: ({ event }) => ({
						target: 'persisting',
						context: { connection: event.connection, pendingConnection: undefined }
					})
				}
			},
			persisting: {
				invoke: {
					id: 'write',
					src: 'write',
					input: ({ context }: { context: Context }) => context.connection!,
					onDone: { target: 'notifying' },
					onError: { target: 'failed' }
				}
			},
			notifying: {
				invoke: {
					id: 'notify',
					src: 'notify',
					input: ({ context }: { context: Context }) => context.connection!.accountId,
					onDone: { target: 'done' },
					onError: { target: 'done' }
				}
			},
			done: {
				type: 'final',
				entry: () => {
					return { context: { accepted: true, connection: undefined, message: undefined } }
				}
			},
			failed: {
				type: 'final',
				entry: () => {
					return { context: { connection: undefined, message: undefined } }
				}
			}
		}
	})
}
