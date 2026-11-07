import { and, assign, fromPromise, setup } from 'xstate'
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
		read: fromPromise(({ input }: { input: string }) => cap.read(input)),
		show: fromPromise(({ input }: { input: NotificationDisplay }) => cap.show(input))
	}
	return setup<
		Context,
		{ type: 'UNUSED' },
		typeof actors,
		{},
		{
			decode: undefined
			rememberStored: { value: unknown }
			prepareWaiting: undefined
			prepareProgress: undefined
			accept: undefined
		},
		{
			validMessage: undefined
			trustedSender: undefined
			admitted: undefined
			waitingNotification: undefined
			matchingCapture: { value: unknown }
		},
		never,
		string,
		Input,
		{ accepted: boolean }
	>({
		actors,
		guards: {
			validMessage: ({ context }) => notificationSchema.safeParse(context.message).success,
			trustedSender: ({ context }) => trustedSender(context.sender, cap.id, cap.page),
			admitted: and(['validMessage', 'trustedSender']),
			waitingNotification: ({ context }) => waitingSchema.safeParse(context.message).success,
			matchingCapture: ({ context }, params) =>
				captureFor(params.value, waitingSchema.parse(context.request).id)
		},
		actions: {
			decode: assign({ request: ({ context }) => notificationSchema.parse(context.message) }),
			rememberStored: assign({ stored: (_, params) => params.value }),
			prepareWaiting: assign({
				display: ({ context }) => {
					const request = waitingSchema.parse(context.request)
					return {
						capture: captureSchema.parse(context.stored),
						message: request.message,
						revision: request.revision
					}
				}
			}),
			prepareProgress: assign({
				display: ({ context }) => {
					const request = progressSchema.parse(context.request)
					return {
						capture: request.capture,
						message: request.message,
						revision: request.revision,
						...(request.articleId === undefined ? {} : { articleId: request.articleId })
					}
				}
			}),
			accept: assign({ accepted: true })
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
				always: [
					{
						guard: and(['admitted', 'waitingNotification']),
						target: 'readingCapture',
						actions: 'decode'
					},
					{ guard: 'admitted', target: 'showing', actions: ['decode', 'prepareProgress'] },
					{ target: 'failed' }
				]
			},
			readingCapture: {
				invoke: {
					src: 'read',
					input: ({ context }) => waitingSchema.parse(context.request).id,
					onDone: [
						{
							guard: { type: 'matchingCapture', params: ({ event }) => ({ value: event.output }) },
							target: 'showing',
							actions: [
								{ type: 'rememberStored', params: ({ event }) => ({ value: event.output }) },
								'prepareWaiting'
							]
						},
						{ target: 'failed' }
					],
					onError: 'failed'
				}
			},
			showing: {
				invoke: {
					src: 'show',
					input: ({ context }) => notificationDisplay(context),
					onDone: { target: 'done', actions: 'accept' },
					onError: 'failed'
				}
			},
			failed: { type: 'final' },
			done: { type: 'final' }
		}
	})
}
