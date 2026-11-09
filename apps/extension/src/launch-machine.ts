import type { EventPayload } from '../../web/src/lib/machines/events.js'
import { types, createCallbackLogic, setup, createAsyncLogic } from 'xstate'

import { z } from 'zod'
import { sourceUrlSchema, sameSource } from './protocol.js'
import { newlyConfirmedConnection } from './connection.js'
import type { Connection, Authorization } from './connection.js'
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
	pendingCapture: Omit<Capture, 'id'> | undefined
	pending: Capture[]
	queued: Tab[]
	connection: Connection | undefined
	popupId: number | undefined
	signInRequest: string | undefined
	authorizationAttempts: number
}
export function createLaunchMachine(cap: {
	connection: () => Promise<Connection | undefined>
	authorize: (connection: Connection) => Promise<Authorization>
	openSignIn: (requestId: string) => Promise<number>
	watchPopup: (id: number, closed: () => void) => () => void
	focusPopup: (id: number) => Promise<unknown>
	inspect: (id: number) => Promise<unknown>
	pending: () => Promise<Capture[]>
	persist: (capture: Capture) => Promise<void>
	show: (capture: Capture, message: WorkflowMessage) => Promise<unknown>
	runtimeExists: () => Promise<boolean>
	createRuntime: () => Promise<void>
	dispatch: (id: string, accountId: string) => Promise<boolean>
	reject: (tab: Tab | undefined, text: string) => Promise<unknown>
	id: () => string
}) {
	const actors = {
		identity: createCallbackLogic<never>(({ sendBack }) => {
			sendBack({ type: 'IDENTITY_ISSUED', id: cap.id() })
		}),
		connection: createAsyncLogic({ run: () => cap.connection() }),
		authorize: createAsyncLogic({
			run: ({ input }: { input: Connection }) => cap.authorize(input)
		}),
		openSignIn: createAsyncLogic({ run: ({ input }: { input: string }) => cap.openSignIn(input) }),
		popup: createCallbackLogic<{ type: 'UNUSED' }, number>(({ input, sendBack }) =>
			cap.watchPopup(input, () => sendBack({ type: 'POPUP_CLOSED' }))
		),
		accountUnavailable: createAsyncLogic({
			run: ({ input }: { input: Tab | undefined }) =>
				cap.reject(input, t('account.status.unavailable'))
		}),
		inspect: createAsyncLogic({ run: ({ input }: { input: number }) => cap.inspect(input) }),
		pending: createAsyncLogic({ run: () => cap.pending() }),
		persist: createAsyncLogic({ run: ({ input }: { input: Capture }) => cap.persist(input) }),
		show: createAsyncLogic({
			run: ({ input }: { input: Capture }) =>
				cap.show(input, { text: t('capture.status.pending'), variant: 'info' })
		}),
		runtimeExists: createAsyncLogic({ run: () => cap.runtimeExists() }),
		createRuntime: createAsyncLogic({ run: () => cap.createRuntime() }),
		dispatch: createAsyncLogic({
			run: ({ input }: { input: { id: string; accountId: string } }) =>
				cap.dispatch(input.id, input.accountId)
		}),
		reject: createAsyncLogic({
			run: ({ input }: { input: Tab | undefined }) =>
				cap.reject(input, t('capture.status.save_failed'))
		}),
		uncertain: createAsyncLogic({
			run: ({ input }: { input: Capture }) =>
				cap.show(input, { text: t('capture.status.unknown'), variant: 'error' })
		}),
		failure: createAsyncLogic({
			run: ({ input }: { input: Capture }) =>
				cap.show(input, { text: t('capture.status.save_failed'), variant: 'error' })
		})
	}
	const model = setup({
		schemas: {
			context: types<Context>(),
			events: {
				IDENTITY_ISSUED: types<{ id: string }>(),
				CLIP: types<EventPayload<{ type: 'CLIP'; tab: Tab } | { type: 'POPUP_CLOSED' }, 'CLIP'>>(),
				POPUP_CLOSED:
					types<
						EventPayload<{ type: 'CLIP'; tab: Tab } | { type: 'POPUP_CLOSED' }, 'POPUP_CLOSED'>
					>()
			},
			children: {
				identity: types<import('xstate').ActorRefFrom<typeof actors.identity>>(),
				connection: types<import('xstate').ActorRefFrom<(typeof actors)['connection']>>(),
				authorize: types<import('xstate').ActorRefFrom<(typeof actors)['authorize']>>(),
				openSignIn: types<import('xstate').ActorRefFrom<(typeof actors)['openSignIn']>>(),
				popup: types<import('xstate').ActorRefFrom<(typeof actors)['popup']>>(),
				accountUnavailable:
					types<import('xstate').ActorRefFrom<(typeof actors)['accountUnavailable']>>(),
				inspect: types<import('xstate').ActorRefFrom<(typeof actors)['inspect']>>(),
				pending: types<import('xstate').ActorRefFrom<(typeof actors)['pending']>>(),
				persist: types<import('xstate').ActorRefFrom<(typeof actors)['persist']>>(),
				show: types<import('xstate').ActorRefFrom<(typeof actors)['show']>>(),
				runtimeExists: types<import('xstate').ActorRefFrom<(typeof actors)['runtimeExists']>>(),
				createRuntime: types<import('xstate').ActorRefFrom<(typeof actors)['createRuntime']>>(),
				dispatch: types<import('xstate').ActorRefFrom<(typeof actors)['dispatch']>>(),
				reject: types<import('xstate').ActorRefFrom<(typeof actors)['reject']>>(),
				uncertain: types<import('xstate').ActorRefFrom<(typeof actors)['uncertain']>>(),
				failure: types<import('xstate').ActorRefFrom<(typeof actors)['failure']>>()
			}
		},
		actors,
		guards: {
			// Offscreen creation can resolve before its ESM message listener is installed.
			// Retry this read-only request for up to ten seconds; explicit refusals
			// and issued capture writes never enter this retry path.
			runtimeMayStillBeStarting: ({ context }: { context: Context }) =>
				context.authorizationAttempts < 50,
			hasCaptureCapacity: (_: { context: Context }, params: { pending: Capture[] }) =>
				params.pending.length < 8
		}
	})
	return model.createMachine({
		initial: 'idle',
		context: {
			tab: undefined,
			capture: undefined,
			pendingCapture: undefined,
			pending: [],
			queued: [],
			connection: undefined,
			popupId: undefined,
			signInRequest: undefined,
			authorizationAttempts: 0
		},
		on: {
			CLIP: (args) => {
				const { context, event } = args
				if (!(context.queued.length < 8)) return
				return {
					context: {
						queued: event.type === 'CLIP' ? [...context.queued, event.tab] : context.queued
					}
				}
			}
		},
		states: {
			idle: {
				entry: () => {
					return {
						context: {
							tab: undefined,
							capture: undefined,
							pending: [],
							connection: undefined,
							popupId: undefined,
							signInRequest: undefined,
							authorizationAttempts: 0
						}
					}
				},
				always: (args) => {
					const { context } = args
					if (!(context.queued.length > 0)) return
					return {
						target: 'checkingConnection',
						context: { tab: context.queued[0], queued: context.queued.slice(1) }
					}
				}
			},
			checkingConnection: {
				invoke: {
					id: 'connection',
					src: 'connection',
					onDone: (args) => {
						const { event } = args
						if (event.output) {
							return { target: 'checkingRuntime', context: { connection: event.output } }
						}
						return { target: 'identifyingSignIn' }
					},
					onError: { target: 'accountUnavailable' }
				}
			},
			identifyingSignIn: {
				invoke: { id: 'identity', src: 'identity', onError: { target: 'accountUnavailable' } },
				on: {
					CLIP: {},
					IDENTITY_ISSUED: ({ event }) => ({
						target: 'openingSignIn',
						context: { signInRequest: event.id }
					})
				}
			},
			openingSignIn: {
				on: { CLIP: {} },
				invoke: {
					id: 'openSignIn',
					src: 'openSignIn',
					input: ({ context }: { context: Context }) => context.signInRequest!,
					onDone: (args) => {
						return { target: 'waitingForSignIn', context: { popupId: args.event.output } }
					},
					onError: { target: 'accountUnavailable' }
				}
			},
			waitingForSignIn: {
				invoke: {
					id: 'popup',
					src: 'popup',
					input: ({ context }: { context: Context }) => context.popupId!
				},
				on: {
					POPUP_CLOSED: { target: 'checkingConfirmation' },
					CLIP: (args, enq) => {
						enq(({ context }) => {
							void cap.focusPopup(context.popupId!).catch(() => {})
						}, args)
					}
				}
			},
			checkingConfirmation: {
				invoke: {
					id: 'connection',
					src: 'connection',
					onDone: (args) => {
						const { context, event } = args
						if (
							newlyConfirmedConnection(event.output, context.connection, context.signInRequest!)
						) {
							return {
								target: 'checkingRuntime',
								context: { connection: event.output, authorizationAttempts: 0 }
							}
						}
						return { target: 'idle' }
					},
					onError: { target: 'accountUnavailable' }
				}
			},
			authorizing: {
				entry: (args) => {
					return { context: { authorizationAttempts: args.context.authorizationAttempts + 1 } }
				},
				invoke: {
					id: 'authorize',
					src: 'authorize',
					input: ({ context }: { context: Context }) => context.connection!,
					onDone: (args) => {
						const { event } = args
						if (event.output === 'connected') {
							return { target: 'admitting' }
						}
						if (event.output === 'signed-out') {
							return { target: 'identifyingSignIn' }
						}
						return { target: 'accountUnavailable' }
					},
					onError: (args) => {
						if (args.guards.runtimeMayStillBeStarting(args)) {
							return { target: 'retryingAuthorization' }
						}
						return { target: 'accountUnavailable' }
					}
				}
			},
			retryingAuthorization: { after: { 200: { target: 'checkingRuntime' } } },
			accountUnavailable: {
				invoke: {
					id: 'accountUnavailable',
					src: 'accountUnavailable',
					input: ({ context }: { context: Context }) => context.tab,
					onDone: { target: 'idle' },
					onError: { target: 'idle' }
				}
			},

			admitting: {
				type: 'choice',
				choice: (args) => {
					const { context } = args
					if (context.tab?.id !== undefined && sourceUrlSchema.safeParse(context.tab.url).success) {
						return { target: 'inspecting' }
					}
					return { target: 'failure' }
				}
			},
			inspecting: {
				invoke: {
					id: 'inspect',
					src: 'inspect',
					input: ({ context }: { context: Context }) => context.tab!.id!,
					onDone: (args) => {
						if (
							(({ context, event }) => {
								const parsed = evidenceSchema.safeParse(event.output)
								return parsed.success && sameSource(parsed.data.result, context.tab!.url!)
							})(args)
						) {
							return {
								target: 'identifyingCapture',
								context: {
									pendingCapture: (({ context, event }) => {
										const evidence = evidenceSchema.parse(event.output)
										return {
											version: 1,
											tabId: context.tab!.id!,
											documentId: evidence.documentId,
											url: evidence.result,
											phase: 'ready'
										}
									})(args)
								}
							}
						}
						return { target: 'failure' }
					},
					onError: { target: 'failure' }
				}
			},
			identifyingCapture: {
				invoke: { id: 'identity', src: 'identity', onError: { target: 'failure' } },
				on: {
					IDENTITY_ISSUED: ({ context, event }) => ({
						target: 'listing',
						context: {
							capture: { ...context.pendingCapture!, id: event.id },
							pendingCapture: undefined
						}
					})
				}
			},
			listing: {
				invoke: {
					id: 'pending',
					src: 'pending',
					onDone: (args) => {
						const { event } = args
						if (args.guards.hasCaptureCapacity(args, { pending: event.output })) {
							return { target: 'persisting', context: { pending: event.output } }
						}
						return { target: 'failure' }
					},
					onError: { target: 'failure' }
				}
			},
			persisting: {
				invoke: {
					id: 'persist',
					src: 'persist',
					input: ({ context }: { context: Context }) => context.capture!,
					onDone: { target: 'showing' },
					onError: { target: 'failure' }
				}
			},
			showing: {
				invoke: {
					id: 'show',
					src: 'show',
					input: ({ context }: { context: Context }) => context.capture!,
					onDone: { target: 'dispatching' },
					onError: { target: 'dispatching' }
				}
			},
			checkingRuntime: {
				invoke: {
					id: 'runtimeExists',
					src: 'runtimeExists',
					onDone: (args) => {
						if (args.event.output) {
							return { target: 'authorizing' }
						}
						return { target: 'creatingRuntime' }
					},
					onError: { target: 'failure' }
				}
			},
			creatingRuntime: {
				invoke: {
					id: 'createRuntime',
					src: 'createRuntime',
					onDone: { target: 'authorizing' },
					onError: { target: 'failure' }
				}
			},
			dispatching: {
				invoke: {
					id: 'dispatch',
					src: 'dispatch',
					input: ({ context }: { context: Context }) => ({
						id: context.capture!.id,
						accountId: context.connection!.accountId
					}),
					onDone: (args) => {
						if (args.event.output) {
							return { target: 'idle' }
						}
						return { target: 'failure' }
					},
					onError: { target: 'uncertain' }
				}
			},
			uncertain: {
				invoke: {
					id: 'uncertain',
					src: 'uncertain',
					input: ({ context }: { context: Context }) => context.capture!,
					onDone: { target: 'idle' },
					onError: { target: 'idle' }
				}
			},
			failure: {
				type: 'choice',
				choice: (args) => {
					if (args.context.capture) {
						return { target: 'showingFailure' }
					}
					return { target: 'rejecting' }
				}
			},
			showingFailure: {
				invoke: {
					id: 'failure',
					src: 'failure',
					input: ({ context }: { context: Context }) => context.capture!,
					onDone: { target: 'idle' },
					onError: { target: 'idle' }
				}
			},
			rejecting: {
				invoke: {
					id: 'reject',
					src: 'reject',
					input: ({ context }: { context: Context }) => context.tab,
					onDone: { target: 'idle' },
					onError: { target: 'idle' }
				}
			}
		}
	})
}
