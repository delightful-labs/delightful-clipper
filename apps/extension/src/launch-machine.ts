import { assign, fromCallback, fromPromise, setup } from 'xstate'
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
		connection: fromPromise(() => cap.connection()),
		authorize: fromPromise(({ input }: { input: Connection }) => cap.authorize(input)),
		openSignIn: fromPromise(({ input }: { input: string }) => cap.openSignIn(input)),
		popup: fromCallback<{ type: 'UNUSED' }, number>(({ input, sendBack }) =>
			cap.watchPopup(input, () => sendBack({ type: 'POPUP_CLOSED' }))
		),
		accountUnavailable: fromPromise(({ input }: { input: Tab | undefined }) =>
			cap.reject(input, t('account.status.unavailable'))
		),
		inspect: fromPromise(({ input }: { input: number }) => cap.inspect(input)),
		pending: fromPromise(() => cap.pending()),
		persist: fromPromise(({ input }: { input: Capture }) => cap.persist(input)),
		show: fromPromise(({ input }: { input: Capture }) =>
			cap.show(input, { text: t('capture.status.pending'), variant: 'info' })
		),
		runtimeExists: fromPromise(() => cap.runtimeExists()),
		createRuntime: fromPromise(() => cap.createRuntime()),
		dispatch: fromPromise(({ input }: { input: { id: string; accountId: string } }) =>
			cap.dispatch(input.id, input.accountId)
		),
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
	const model = setup<
		Context,
		{ type: 'CLIP'; tab: Tab } | { type: 'POPUP_CLOSED' },
		typeof actors
	>({
		actors
	}).extend({
		guards: {
			hasCaptureCapacity: (_, params: { pending: Capture[] }) => params.pending.length < 8
		}
	})
	return model.createMachine({
		initial: 'idle',
		context: {
			tab: undefined,
			capture: undefined,
			pending: [],
			queued: [],
			connection: undefined,
			popupId: undefined,
			signInRequest: undefined,
			authorizationAttempts: 0
		},
		on: {
			CLIP: {
				guard: ({ context }) => context.queued.length < 8,
				actions: assign({
					queued: ({ context, event }) =>
						event.type === 'CLIP' ? [...context.queued, event.tab] : context.queued
				})
			}
		},
		states: {
			idle: {
				entry: assign({
					tab: undefined,
					capture: undefined,
					pending: [],
					connection: undefined,
					popupId: undefined,
					signInRequest: undefined,
					authorizationAttempts: 0
				}),
				always: {
					guard: ({ context }) => context.queued.length > 0,
					target: 'checkingConnection',
					actions: assign({
						tab: ({ context }) => context.queued[0],
						queued: ({ context }) => context.queued.slice(1)
					})
				}
			},
			checkingConnection: {
				invoke: {
					src: 'connection',
					onDone: [
						{
							guard: ({ event }) => !!event.output,
							target: 'checkingRuntime',
							actions: assign({ connection: ({ event }) => event.output })
						},
						{ target: 'openingSignIn' }
					],
					onError: 'accountUnavailable'
				}
			},
			openingSignIn: {
				entry: assign({ signInRequest: () => cap.id() }),
				on: { CLIP: {} },
				invoke: {
					src: 'openSignIn',
					input: ({ context }) => context.signInRequest!,
					onDone: {
						target: 'waitingForSignIn',
						actions: assign({ popupId: ({ event }) => event.output })
					},
					onError: 'accountUnavailable'
				}
			},
			waitingForSignIn: {
				invoke: { src: 'popup', input: ({ context }) => context.popupId! },
				on: {
					POPUP_CLOSED: 'checkingConfirmation',
					CLIP: {
						actions: ({ context }) => {
							void cap.focusPopup(context.popupId!).catch(() => {})
						}
					}
				}
			},
			checkingConfirmation: {
				invoke: {
					src: 'connection',
					onDone: [
						{
							guard: ({ context, event }) =>
								newlyConfirmedConnection(event.output, context.connection, context.signInRequest!),
							target: 'checkingRuntime',
							actions: assign({
								connection: ({ event }) => event.output,
								authorizationAttempts: 0
							})
						},
						{ target: 'idle' }
					],
					onError: 'accountUnavailable'
				}
			},
			authorizing: {
				entry: assign({
					authorizationAttempts: ({ context }) => context.authorizationAttempts + 1
				}),
				invoke: {
					src: 'authorize',
					input: ({ context }) => context.connection!,
					onDone: [
						{ guard: ({ event }) => event.output === 'connected', target: 'admitting' },
						{ guard: ({ event }) => event.output === 'signed-out', target: 'openingSignIn' },
						{ target: 'accountUnavailable' }
					],
					onError: [
						{
							guard: ({ context }) => context.authorizationAttempts < 3,
							target: 'retryingAuthorization'
						},
						{ target: 'accountUnavailable' }
					]
				}
			},
			retryingAuthorization: { after: { 200: 'checkingRuntime' } },
			accountUnavailable: {
				invoke: {
					src: 'accountUnavailable',
					input: ({ context }) => context.tab,
					onDone: 'idle',
					onError: 'idle'
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
					onDone: [
						{
							guard: {
								type: 'hasCaptureCapacity',
								params: ({ event }) => ({ pending: event.output })
							},
							target: 'persisting',
							actions: assign({ pending: ({ event }) => event.output })
						},
						{ target: 'failure' }
					],
					onError: 'failure'
				}
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
					onDone: 'dispatching',
					onError: 'dispatching'
				}
			},
			checkingRuntime: {
				invoke: {
					src: 'runtimeExists',
					onDone: [
						{ guard: ({ event }) => event.output, target: 'authorizing' },
						{ target: 'creatingRuntime' }
					],
					onError: 'failure'
				}
			},
			creatingRuntime: {
				invoke: { src: 'createRuntime', onDone: 'authorizing', onError: 'failure' }
			},
			dispatching: {
				invoke: {
					src: 'dispatch',
					input: ({ context }) => ({
						id: context.capture!.id,
						accountId: context.connection!.accountId
					}),
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
