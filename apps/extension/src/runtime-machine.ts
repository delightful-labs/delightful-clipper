import type { EventPayload } from '../../web/src/lib/machines/events.js'
import {
	types,
	createActor,
	createCallbackLogic,
	setup,
	createAsyncLogic,
	matchesState,
	type ActorRefFrom,
	type SnapshotFrom
} from 'xstate'

import { stopAfterShutdown } from 'delightful-local-first/forms/lifecycle'
import { createClipMachine } from './clip-machine.js'
import type { ApplicationStatus } from '../../web/src/lib/machines/runtime/application-readiness.js'
import type { WorkflowMessage } from '../../web/src/lib/contracts/feedback.js'
import type { ClipCapability } from './clip-machine.js'
import type { libraryMachine } from '../../web/src/lib/machines/capture/library.js'
type Library = ActorRefFrom<typeof libraryMachine>
export type ClipSnapshot = SnapshotFrom<ReturnType<typeof createClipMachine>>
type Event =
	| {
			type: 'BIND'
			library: Library | undefined
			message?: WorkflowMessage
			accountStatus?: ApplicationStatus
	  }
	| { type: 'RUN'; id: string; accountId: string }
	| { type: 'ACCOUNT_CHANGED'; accountId: string }
	| { type: 'CLIP'; snapshot: ClipSnapshot }
type Context = {
	library: Library | undefined
	owner: Library | undefined
	queue: string[]
	id: string
	revision: number
	accountMessage: WorkflowMessage | undefined
	accountStatus: ApplicationStatus | undefined
}
export function createRuntimeMachine(cap: {
	reload: () => Promise<void>
	account: (
		bind: (
			library: Library | undefined,
			message: WorkflowMessage,
			status: ApplicationStatus
		) => void
	) => () => void
	clip: (library: Library) => ClipCapability
	waiting: (ids: string[], message: WorkflowMessage, revision: number) => Promise<unknown>
	report: (snapshot: ClipSnapshot, revision: number) => Promise<unknown>
}) {
	const actors = {
		reload: createAsyncLogic({ run: () => cap.reload() }),
		account: createCallbackLogic(({ sendBack }) =>
			cap.account((library, message, accountStatus) =>
				sendBack({ type: 'BIND', library, message, accountStatus })
			)
		),
		clip: createCallbackLogic<{ type: 'SHUTDOWN' }, { library: Library; id: string }>(
			({ input, sendBack, receive }) => {
				const actor = createActor(createClipMachine(cap.clip(input.library)), {
					input: { id: input.id }
				})
				const subscription = actor.subscribe((snapshot) => sendBack({ type: 'CLIP', snapshot }))
				receive((event) => actor.send(event))
				actor.start()
				return () => {
					subscription.unsubscribe()
					stopAfterShutdown(actor)
				}
			}
		)
	}
	return setup({
		schemas: {
			context: types<Context>(),
			events: {
				BIND: types<EventPayload<Event, 'BIND'>>(),
				RUN: types<EventPayload<Event, 'RUN'>>(),
				ACCOUNT_CHANGED: types<EventPayload<Event, 'ACCOUNT_CHANGED'>>(),
				CLIP: types<EventPayload<Event, 'CLIP'>>()
			},
			children: {
				reload: types<import('xstate').ActorRefFrom<(typeof actors)['reload']>>(),
				account: types<import('xstate').ActorRefFrom<(typeof actors)['account']>>(),
				clip: types<import('xstate').ActorRefFrom<(typeof actors)['clip']>>()
			}
		},
		actors,
		guards: {
			queued: ({ context }: { context: Context }) => !!context.library && context.queue.length > 0,
			admit: ({ context, event }: { context: Context; event: Event }) =>
				event.type === 'RUN' &&
				event.accountId === context.library?.getSnapshot().context.capability?.libraryId &&
				context.queue.length < 8 &&
				context.id !== event.id &&
				!context.queue.includes(event.id),
			changedOwner: ({ context, event }: { context: Context; event: Event }) =>
				event.type === 'BIND' && event.library !== context.owner,
			settled: ({ event }: { event: Event }) =>
				event.type === 'CLIP' &&
				(event.snapshot.matches('saved') ||
					event.snapshot.matches('unknown') ||
					event.snapshot.matches('failed')),
			closed: ({ event }: { event: Event }) =>
				event.type === 'CLIP' && event.snapshot.status === 'done',
			differentAccount: ({ context, event }: { context: Context; event: Event }) =>
				event.type === 'ACCOUNT_CHANGED' &&
				event.accountId !== context.library?.getSnapshot().context.capability?.libraryId
		},
		actions: {
			accountFeedback: ({ context }: { context: Context }) => {
				if (!context.accountMessage) return
				void cap.waiting(context.queue, context.accountMessage, context.revision).catch(() => {})
			},
			report: ({ context, event }: { context: Context; event: Event }) => {
				if (event.type !== 'CLIP') return
				void cap.report(event.snapshot, context.revision).catch(() => {})
			}
		}
	}).createMachine({
		id: 'extension-runtime',
		initial: 'idle',
		context: {
			library: undefined,
			owner: undefined,
			queue: [],
			id: '',
			revision: 0,
			accountMessage: undefined,
			accountStatus: undefined
		},
		invoke: { id: 'account', src: 'account' },
		on: {
			ACCOUNT_CHANGED: (args) => {
				if (!args.guards.differentAccount(args)) return
				return { target: '.reloading', context: { queue: [] } }
			},
			BIND: (args, enq) => {
				const { event } = args
				let context = args.context
				let patch = {}
				patch = {
					...patch,
					library: event.library,
					accountMessage: event.message,
					accountStatus: event.accountStatus,
					revision: context.revision + 1
				}
				context = { ...args.context, ...patch }
				enq(args.actions.accountFeedback, { ...args, context })
				return { context: patch }
			},
			RUN: (args, enq) => {
				if (
					!(
						args.guards.admit(args) &&
						!matchesState('reloading', args.value) &&
						!matchesState({ job: 'restarting' }, args.value)
					)
				)
					return
				let context = args.context
				let patch = {}
				patch = {
					...patch,
					queue: [...context.queue, args.event.id],
					revision: context.revision + 1
				}
				context = { ...args.context, ...patch }
				enq(args.actions.accountFeedback, { ...args, context })
				return { context: patch }
			}
		},
		states: {
			reloading: { invoke: { id: 'reload', src: 'reload' }, on: { ACCOUNT_CHANGED: {} } },
			idle: {
				entry: () => {
					return { context: { owner: undefined, id: '' } }
				},
				always: (args) => {
					if (!args.guards.queued(args)) return
					const { context } = args
					return {
						target: 'job',
						context: {
							owner: context.library,
							id: context.queue[0]!,
							queue: context.queue.slice(1)
						}
					}
				}
			},
			job: {
				initial: 'active',
				invoke: {
					id: 'clip',
					src: 'clip',
					input: ({ context }: { context: Context }) => ({
						library: context.owner!,
						id: context.id
					})
				},
				on: {
					ACCOUNT_CHANGED: (args, enq) => {
						if (!args.guards.differentAccount(args)) return
						enq.sendTo('clip', { type: 'SHUTDOWN' })
						return { target: '.restarting', context: { queue: [] } }
					},
					BIND: (args, enq) => {
						if (!args.guards.changedOwner(args)) return
						enq.sendTo('clip', { type: 'SHUTDOWN' })
						return { target: '.draining', context: { library: args.event.library, queue: [] } }
					},
					CLIP: (args, enq) => {
						let context = args.context
						let patch = {}
						patch = { ...patch, revision: context.revision + 1 }
						context = { ...args.context, ...patch }
						enq(args.actions.report, { ...args, context })
						return { context: patch }
					}
				},
				states: {
					active: {
						on: {
							CLIP: (args, enq) => {
								if (args.guards.settled(args)) {
									let context = args.context
									let patch = {}
									patch = { ...patch, revision: context.revision + 1 }
									context = { ...args.context, ...patch }
									enq(args.actions.report, { ...args, context })
									return { target: 'observing', context: patch }
								}
								if (args.guards.closed(args)) {
									return { target: '#extension-runtime.idle' }
								}
							}
						}
					},
					observing: {
						always: (args) => {
							if (!args.guards.queued(args)) return
							return { target: '#extension-runtime.idle' }
						}
					},
					restarting: {
						on: {
							ACCOUNT_CHANGED: {},
							CLIP: (args, enq) => {
								if (args.guards.closed(args)) {
									return { target: '#extension-runtime.reloading' }
								}
								if (args.guards.settled(args)) {
									enq.sendTo('clip', { type: 'SHUTDOWN' })
									return {}
								}
							}
						}
					},
					draining: {
						on: {
							CLIP: (args, enq) => {
								if (args.guards.closed(args)) {
									return { target: '#extension-runtime.idle' }
								}
								if (args.guards.settled(args)) {
									enq.sendTo('clip', { type: 'SHUTDOWN' })
									return {}
								}
							}
						}
					}
				}
			}
		}
	})
}

export type RuntimeSnapshot = SnapshotFrom<ReturnType<typeof createRuntimeMachine>>
