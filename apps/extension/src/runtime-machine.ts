import {
	and,
	assign,
	createActor,
	fromCallback,
	fromPromise,
	not,
	sendTo,
	setup,
	stateIn
} from 'xstate'
import type { ActorRefFrom, SnapshotFrom } from 'xstate'
import { stopAfterShutdown } from 'delightful-local-first/forms/lifecycle'
import { createClipMachine } from './clip-machine.js'
import type { WorkflowMessage } from '../../web/src/lib/contracts/feedback.js'
import type { ClipCapability } from './clip-machine.js'
import type { libraryMachine } from '../../web/src/lib/machines/capture/library.js'
type Library = ActorRefFrom<typeof libraryMachine>
export type ClipSnapshot = SnapshotFrom<ReturnType<typeof createClipMachine>>
type Event =
	| { type: 'BIND'; library: Library | undefined; message?: WorkflowMessage }
	| { type: 'RUN'; id: string }
	| { type: 'ACCOUNT_CHANGED'; accountId: string }
	| { type: 'CLIP'; snapshot: ClipSnapshot }
type Context = {
	library: Library | undefined
	owner: Library | undefined
	queue: string[]
	id: string
	revision: number
	accountMessage: WorkflowMessage | undefined
}
export function createRuntimeMachine(cap: {
	reload: () => Promise<void>
	account: (bind: (library: Library | undefined, message: WorkflowMessage) => void) => () => void
	clip: (library: Library) => ClipCapability
	waiting: (ids: string[], message: WorkflowMessage, revision: number) => Promise<unknown>
	report: (snapshot: ClipSnapshot, revision: number) => Promise<unknown>
}) {
	const actors = {
		reload: fromPromise(() => cap.reload()),
		account: fromCallback(({ sendBack }) =>
			cap.account((library, message) => sendBack({ type: 'BIND', library, message }))
		),
		clip: fromCallback<{ type: 'SHUTDOWN' }, { library: Library; id: string }>(
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
	return setup<
		Context,
		Event,
		typeof actors,
		{},
		{ report: undefined; accountFeedback: undefined },
		{
			queued: undefined
			admit: undefined
			changedOwner: undefined
			settled: undefined
			closed: undefined
			differentAccount: undefined
		}
	>({
		actors,
		guards: {
			queued: ({ context }) => !!context.library && context.queue.length > 0,
			admit: ({ context, event }) =>
				event.type === 'RUN' &&
				context.queue.length < 8 &&
				context.id !== event.id &&
				!context.queue.includes(event.id),
			changedOwner: ({ context, event }) =>
				event.type === 'BIND' && event.library !== context.owner,
			settled: ({ event }) =>
				event.type === 'CLIP' &&
				(event.snapshot.matches('saved') ||
					event.snapshot.matches('unknown') ||
					event.snapshot.matches('failed')),
			closed: ({ event }) => event.type === 'CLIP' && event.snapshot.status === 'done',
			differentAccount: ({ context, event }) =>
				event.type === 'ACCOUNT_CHANGED' &&
				event.accountId !== context.library?.getSnapshot().context.capability?.libraryId
		},
		actions: {
			accountFeedback: ({ context }) => {
				if (!context.accountMessage) return
				void cap.waiting(context.queue, context.accountMessage, context.revision).catch(() => {})
			},
			report: ({ context, event }) => {
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
			accountMessage: undefined
		},
		invoke: { src: 'account' },
		on: {
			ACCOUNT_CHANGED: {
				guard: 'differentAccount',
				target: '.reloading',
				actions: assign({ queue: [] })
			},
			BIND: {
				actions: [
					assign({
						library: ({ event }) => event.library,
						accountMessage: ({ event }) => event.message,
						revision: ({ context }) => context.revision + 1
					}),
					'accountFeedback'
				]
			},
			RUN: {
				guard: and(['admit', not(stateIn('reloading')), not(stateIn({ job: 'restarting' }))]),
				actions: [
					assign({
						queue: ({ context, event }) => [...context.queue, event.id],
						revision: ({ context }) => context.revision + 1
					}),
					'accountFeedback'
				]
			}
		},
		states: {
			reloading: { invoke: { src: 'reload' }, on: { ACCOUNT_CHANGED: {} } },
			idle: {
				entry: assign({ owner: undefined, id: '' }),
				always: {
					guard: 'queued',
					target: 'job',
					actions: assign({
						owner: ({ context }) => context.library,
						id: ({ context }) => context.queue[0]!,
						queue: ({ context }) => context.queue.slice(1)
					})
				}
			},
			job: {
				initial: 'active',
				invoke: {
					id: 'clip',
					src: 'clip',
					input: ({ context }) => ({ library: context.owner!, id: context.id })
				},
				on: {
					ACCOUNT_CHANGED: {
						guard: 'differentAccount',
						target: '.restarting',
						actions: [assign({ queue: [] }), sendTo('clip', { type: 'SHUTDOWN' })]
					},
					BIND: {
						guard: 'changedOwner',
						target: '.draining',
						actions: [
							assign({ library: ({ event }) => event.library, queue: [] }),
							sendTo('clip', { type: 'SHUTDOWN' })
						]
					},
					CLIP: { actions: [assign({ revision: ({ context }) => context.revision + 1 }), 'report'] }
				},
				states: {
					active: {
						on: {
							CLIP: [
								{
									guard: 'settled',
									target: 'observing',
									actions: [assign({ revision: ({ context }) => context.revision + 1 }), 'report']
								},
								{ guard: 'closed', target: '#extension-runtime.idle' }
							]
						}
					},
					observing: { always: { guard: 'queued', target: '#extension-runtime.idle' } },
					restarting: {
						on: {
							ACCOUNT_CHANGED: {},
							CLIP: [
								{ guard: 'closed', target: '#extension-runtime.reloading' },
								{ guard: 'settled', actions: sendTo('clip', { type: 'SHUTDOWN' }) }
							]
						}
					},
					draining: {
						on: {
							CLIP: [
								{ guard: 'closed', target: '#extension-runtime.idle' },
								{ guard: 'settled', actions: sendTo('clip', { type: 'SHUTDOWN' }) }
							]
						}
					}
				}
			}
		}
	})
}
