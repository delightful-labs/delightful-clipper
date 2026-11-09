import type { EventPayload } from '../../web/src/lib/machines/events.js'
import { types, setup, createAsyncLogic } from 'xstate'

import {
	notificationSchema,
	progressSchema,
	waitingSchema,
	captureSchema,
	captureFor,
	trustedSender
} from './protocol.js'
import type { Capture, NotificationMessage } from './protocol.js'
import type { WorkflowMessage } from '../../web/src/lib/contracts/feedback.js'
export type NotificationDisplay = {
	capture: Capture
	message: WorkflowMessage
	revision: number
	articleId?: string
}
type Input = { message: unknown; sender: chrome.runtime.MessageSender }
type Context = Input & {
	request: NotificationMessage | undefined
	stored: unknown
	display: NotificationDisplay | undefined
	accepted: boolean
}

function notificationDisplay(context: Pick<Context, 'display'>) {
	if (!context.display) throw new Error('Missing notification display')
	return context.display
}

export function createNotificationMachine(cap: {
	id: string
	page: string
	read: (id: string) => Promise<unknown>
	show: (display: NotificationDisplay) => Promise<unknown>
}) {
	const actors = {
		read: createAsyncLogic({ run: ({ input }: { input: string }) => cap.read(input) }),
		show: createAsyncLogic({ run: ({ input }: { input: NotificationDisplay }) => cap.show(input) })
	}
	return setup({
		schemas: {
			context: types<Context>(),
			events: { UNUSED: types<EventPayload<{ type: 'UNUSED' }, 'UNUSED'>>() },
			input: types<Input>(),
			output: types<{ accepted: boolean }>(),
			tags: types<string>(),
			children: {
				read: types<import('xstate').ActorRefFrom<(typeof actors)['read']>>(),
				show: types<import('xstate').ActorRefFrom<(typeof actors)['show']>>()
			}
		},
		actors,
		guards: {
			validMessage: ({ context }: { context: Context }) =>
				notificationSchema.safeParse(context.message).success,
			trustedSender: ({ context }: { context: Context }) =>
				trustedSender(context.sender, cap.id, cap.page),

			waitingNotification: ({ context }: { context: Context }) =>
				waitingSchema.safeParse(context.message).success,
			matchingCapture: ({ context }: { context: Context }, params: { value: unknown }) =>
				captureFor(params.value, waitingSchema.parse(context.request).id)
		},
		actions: {
			decode: ({ context }: { context: Context }) => ({
				context: { request: notificationSchema.parse(context.message) }
			}),
			rememberStored: (
				args: { context: Context; value: import('xstate').StateValue },
				params: { value: unknown }
			) => ({
				context: { stored: ((_, params: { value: unknown }) => params.value)(args, params) }
			}),
			prepareWaiting: (args: { context: Context }, _params?: undefined) => ({
				context: {
					display: (({ context }) => {
						const request = waitingSchema.parse(context.request)
						return {
							capture: captureSchema.parse(context.stored),
							message: request.message,
							revision: request.revision
						}
					})(args)
				}
			}),
			prepareProgress: (args: { context: Context }, _params?: undefined) => ({
				context: {
					display: (({ context }) => {
						const request = progressSchema.parse(context.request)
						return {
							capture: request.capture,
							message: request.message,
							revision: request.revision,
							...(request.articleId === undefined ? {} : { articleId: request.articleId })
						}
					})(args)
				}
			}),
			accept: () => ({ context: { accepted: true } })
		}
	}).createMachine({
		id: 'extension-notification',
		context: ({ input }) => ({
			...input,
			request: undefined,
			stored: undefined,
			display: undefined,
			accepted: false
		}),
		initial: 'admitting',
		output: ({ context }) => ({ accepted: context.accepted }),
		states: {
			admitting: {
				always: (args) => {
					if (
						args.guards.validMessage(args) &&
						args.guards.trustedSender(args) &&
						args.guards.waitingNotification(args)
					) {
						return { target: 'readingCapture', context: args.actions.decode(args).context }
					}
					if (args.guards.validMessage(args) && args.guards.trustedSender(args)) {
						let context = args.context
						let patch = {}
						patch = { ...patch, ...args.actions.decode(args).context }
						context = { ...args.context, ...patch }
						patch = { ...patch, ...args.actions.prepareProgress({ ...args, context }).context }
						context = { ...args.context, ...patch }
						return { target: 'showing', context: patch }
					}
					return { target: 'failed' }
				}
			},
			readingCapture: {
				invoke: {
					id: 'read',
					src: 'read',
					input: ({ context }: { context: Context }) => waitingSchema.parse(context.request).id,
					onDone: (args) => {
						const { event } = args
						if (args.guards.matchingCapture(args, { value: event.output })) {
							let context = args.context
							let patch = {}
							patch = {
								...patch,
								...args.actions.rememberStored(args, { value: event.output }).context
							}
							context = { ...args.context, ...patch }
							patch = { ...patch, ...args.actions.prepareWaiting({ ...args, context }).context }
							context = { ...args.context, ...patch }
							return { target: 'showing', context: patch }
						}
						return { target: 'failed' }
					},
					onError: { target: 'failed' }
				}
			},
			showing: {
				invoke: {
					id: 'show',
					src: 'show',
					input: ({ context }: { context: Context }) => notificationDisplay(context),
					onDone: (args) => {
						return { target: 'done', context: args.actions.accept().context }
					},
					onError: { target: 'failed' }
				}
			},
			failed: { type: 'final' },
			done: { type: 'final' }
		}
	})
}
