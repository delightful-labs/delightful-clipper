import type { AccountStore } from 'jazz-tools'
import { createActor, createAsyncLogic, createCallbackLogic, setup, types } from 'xstate'
import type { ActorOptions, ActorRef, ActorRefFrom, Snapshot } from 'xstate'
import { createWorkerEffectDrain } from 'delightful-local-first/worker/effect-drain/workflow'
import type { WorkerHostClosed } from 'delightful-local-first/worker/channel/contracts'
import type { createScopedAccountStorage } from './scoped-storage-channel.js'
import {
	accountWriteCustodyMachine,
	createAccountWriteLedger,
	definitelyNotIssued,
	issueAccountWrite,
	required,
	scopedAccountLock,
	validAccountDeadline
} from './account-write-custody.js'
import type {
	AccountOperationResult,
	AccountWriteLedger,
	DetachedAccountWrite
} from './account-write-custody.js'

type Storage = Pick<
	ReturnType<typeof createScopedAccountStorage>,
	'read' | 'write' | 'host' | 'close'
>
type UpdateInput = {
	key: string
	operationId: string
	scope: string
	storage: Storage
	transform: (value: string | null) => string
	ledger: AccountWriteLedger
	deadlineMs: number
	report: (result: AccountOperationResult) => void
	retain: (custody: DetachedAccountWrite) => void
	onOverdue: (operationId: string) => void
}
type UpdateContext = {
	record: {
		input: UpdateInput | undefined
		current: string | null
		replacement: string
		result: AccountOperationResult
	}
}
const actors = {
	lock: scopedAccountLock,
	read: createAsyncLogic<string | null, Storage>({ run: ({ input }) => input.read() }),
	transform: createAsyncLogic<
		string,
		{ transform: UpdateInput['transform']; current: string | null }
	>({ run: async ({ input }) => input.transform(input.current) }),
	write: createAsyncLogic<void, { storage: Storage; value: string; ledger: AccountWriteLedger }>({
		run: ({ input }) => issueAccountWrite(input.ledger, () => input.storage.write(input.value))
	}),
	drain: createWorkerEffectDrain()
}
/** One SDK transform and original write under the existing native lock name.
 * SDK failure may be observed early; the actor stays alive until real release. */
export const scopedAccountUpdateMachine = setup({
	schemas: {
		context: types<UpdateContext>(),
		input: types<UpdateInput>(),
		output: types<AccountOperationResult>(),
		events: {
			LOCKED: types(),
			LOCK_FAILED: types(),
			LEASE_REVOKED: types<{ outcome: AccountOperationResult['writeOutcome'] }>(),
			RELEASED: types(),
			SHUTDOWN: types()
		},
		children: {
			lock: types<ActorRefFrom<typeof actors.lock>>(),
			read: types<ActorRefFrom<typeof actors.read>>(),
			transform: types<ActorRefFrom<typeof actors.transform>>(),
			write: types<ActorRefFrom<typeof actors.write>>(),
			drain: types<ActorRefFrom<typeof actors.drain>>()
		}
	},
	actors,
	delays: { deadline: ({ context }) => required(context.record.input).deadlineMs },
	guards: {
		validInput: ({ context }: { context: UpdateContext }) => {
			const input = required(context.record.input)
			return (
				validAccountDeadline(input.deadlineMs) && input.scope === input.storage.host.identity.scope
			)
		},
		writeNotIssued: (_: { context: UpdateContext }, error: unknown) => definitelyNotIssued(error)
	},
	actions: {
		unknown: ({ context }: { context: UpdateContext }) => ({
			context: {
				record: {
					...context.record,
					result: {
						...context.record.result,
						ok: false,
						writeOutcome: 'unknown'
					} satisfies AccountOperationResult
				}
			}
		}),
		acknowledged: ({ context }: { context: UpdateContext }) => ({
			context: {
				record: {
					...context.record,
					result: {
						...context.record.result,
						ok: true,
						writeOutcome: 'acknowledged'
					} satisfies AccountOperationResult
				}
			}
		})
	}
}).createMachine({
	id: 'scoped-account-update',
	initial: 'checking',
	context: ({ input }) => ({
		record: {
			input,
			current: null,
			replacement: '',
			result: {
				operationId: input.operationId,
				scope: input.scope,
				ok: false,
				writeOutcome: 'not-issued'
			}
		}
	}),
	output: ({ context }) => context.record.result,
	states: {
		checking: {
			type: 'choice',
			choice: (args) => (args.guards.validInput(args) ? { target: 'owning' } : { target: 'done' })
		},
		owning: {
			initial: 'acquiring',
			invoke: {
				id: 'lock',
				src: 'lock',
				input: ({ context, self }) => {
					const input = required(context.record.input)
					return {
						key: input.key,
						operationId: input.operationId,
						scope: input.scope,
						host: input.storage.host,
						ledger: input.ledger,
						deadlineMs: input.deadlineMs,
						retain: input.retain,
						abandoned: (writeOutcome) =>
							input.report({
								operationId: input.operationId,
								scope: input.scope,
								ok: false,
								writeOutcome
							}),
						onOverdue: input.onOverdue,
						owner: self
					}
				}
			},
			on: {
				LOCK_FAILED: { target: 'done' },
				LEASE_REVOKED: ({ context, event }) => ({
					target: '#scoped-account-update.abandoned',
					context: {
						record: {
							...context.record,
							result: { ...context.record.result, ok: false, writeOutcome: event.outcome }
						}
					}
				})
			},
			states: {
				acquiring: {
					timeout: 'deadline',
					onTimeout: { target: 'releasing.failed' },
					on: { LOCKED: { target: 'reading' }, SHUTDOWN: { target: 'releasing.failed' } }
				},
				reading: {
					timeout: 'deadline',
					onTimeout: { target: 'releasing.failed' },
					on: { SHUTDOWN: { target: 'releasing.failed' } },
					invoke: {
						id: 'read',
						src: 'read',
						input: ({ context }) => required(context.record.input).storage,
						onDone: ({ context, event }) => ({
							target: 'transforming',
							context: { record: { ...context.record, current: event.output } }
						}),
						onError: { target: 'releasing.failed' }
					}
				},
				transforming: {
					on: { SHUTDOWN: { target: 'releasing.failed' } },
					invoke: {
						id: 'transform',
						src: 'transform',
						input: ({ context }) => ({
							transform: required(context.record.input).transform,
							current: context.record.current
						}),
						onDone: ({ context, event }) => ({
							target: 'writing',
							context: { record: { ...context.record, current: null, replacement: event.output } }
						}),
						onError: { target: 'releasing.failed' }
					}
				},
				writing: {
					timeout: 'deadline',
					onTimeout: (args) => ({
						target: 'retaining',
						context: args.actions.unknown(args).context
					}),
					on: {
						SHUTDOWN: (args) => ({
							target: 'retaining',
							context: args.actions.unknown(args).context
						})
					},
					invoke: {
						id: 'write',
						src: 'write',
						input: ({ context }) => ({
							storage: required(context.record.input).storage,
							ledger: required(context.record.input).ledger,
							value: context.record.replacement
						}),
						onDone: (args) => ({
							target: 'releasing',
							context: args.actions.acknowledged(args).context
						}),
						onError: (args) =>
							args.guards.writeNotIssued(args, args.event.error)
								? { target: 'releasing.failed' }
								: { target: 'retaining', context: args.actions.unknown(args).context }
					}
				},
				retaining: {
					entry: ({ context }, enq) =>
						enq(required(context.record.input).report, context.record.result),
					invoke: {
						id: 'drain',
						src: 'drain',
						input: ({ context }) => {
							const input = required(context.record.input)
							return {
								identity: input.storage.host.identity,
								settlement: input.ledger.receipt ?? Promise.resolve({ kind: 'settled' }),
								hostClosed: input.storage.host.closed,
								requestClose: input.storage.host.requestClose,
								deadlineMs: input.deadlineMs,
								onOverdue: () => input.onOverdue(input.operationId)
							}
						},
						onDone: { target: 'releasing.failed' },
						onError: { target: 'blocked' }
					},
					on: { SHUTDOWN: {} }
				},
				releasing: {
					initial: 'waiting',
					entry: (_, enq) => enq.sendTo('lock', { type: 'RELEASE' }),
					timeout: 'deadline',
					onTimeout: ({ context }) => ({
						target: '.overdue',
						context: {
							record: { ...context.record, result: { ...context.record.result, ok: false } }
						}
					}),
					on: { RELEASED: { target: '#scoped-account-update.done' }, SHUTDOWN: {} },
					states: {
						waiting: {},
						failed: {
							entry: ({ context }, enq) =>
								enq(required(context.record.input).report, context.record.result)
						},
						overdue: {
							entry: ({ context }, enq) => {
								enq(required(context.record.input).report, context.record.result)
								enq(required(context.record.input).onOverdue, context.record.result.operationId)
							}
						}
					}
				},
				blocked: {
					entry: ({ context }, enq) =>
						enq(required(context.record.input).onOverdue, context.record.result.operationId)
				}
			}
		},
		abandoned: {
			type: 'final',
			entry: ({ context }, enq) => {
				enq(required(context.record.input).report, context.record.result)
				return {
					context: {
						record: { ...context.record, input: undefined, current: null, replacement: '' }
					}
				}
			}
		},

		done: {
			type: 'final',
			entry: ({ context }, enq) => {
				enq(required(context.record.input).report, context.record.result)
				return {
					context: {
						record: { ...context.record, input: undefined, current: null, replacement: '' }
					}
				}
			}
		}
	}
})

type Call = {
	operationId: string
	transform: UpdateInput['transform']
	report: UpdateInput['report']
}
type Slot = {
	ledger: AccountWriteLedger
	call: Call
	child: ActorRefFrom<typeof scopedAccountUpdateMachine>
	subscription: ActorRef<Snapshot<unknown>, never>
}
type OwnerInput = {
	track: (operationId: string, ledger: AccountWriteLedger | undefined) => void
	key: string
	storage: Storage
	deadlineMs: number
	retain: UpdateInput['retain']
	onOverdue: UpdateInput['onOverdue']
	observeKeepers: (report: (count: number) => void) => () => void
}
type OwnerContext = {
	record: {
		input: OwnerInput | undefined
		slots: Slot[]
		retained: number
		receipt: WorkerHostClosed | undefined
	}
}
const observe = createCallbackLogic<never, OwnerInput>(({ input, sendBack }) =>
	input.observeKeepers((count) => sendBack({ type: 'KEEPERS', count }))
)
const close = createAsyncLogic<WorkerHostClosed, Storage>({ run: ({ input }) => input.close() })
function refused(call: Call, input: OwnerInput): AccountOperationResult {
	return {
		operationId: call.operationId,
		scope: input.storage.host.identity.scope,
		ok: false,
		writeOutcome: 'not-issued'
	}
}
const ownerMachine = setup({
	schemas: {
		context: types<OwnerContext>(),
		input: types<OwnerInput>(),
		output: types<WorkerHostClosed>(),
		events: {
			START: types<{ call: Call }>(),
			DONE: types<{ operationId: string; result: AccountOperationResult }>(),
			KEEPERS: types<{ count: number }>(),
			SHUTDOWN: types()
		},
		children: {
			observe: types<ActorRefFrom<typeof observe>>(),
			close: types<ActorRefFrom<typeof close>>()
		}
	},
	actors: { update: scopedAccountUpdateMachine, observe, close }
}).createMachine({
	id: 'scoped-account-store-owner',
	onError: ({ context, event }, enq) => {
		const failedId = 'actorId' in event ? event.actorId : undefined
		for (const slot of context.record.slots)
			if (slot.call.operationId !== failedId) enq.sendTo(slot.child, { type: 'SHUTDOWN' })
		return { target: failedId === 'observe' ? '.blocked' : '.draining' }
	},
	context: ({ input }) => ({ record: { input, slots: [], retained: 0, receipt: undefined } }),
	initial: 'active',
	output: ({ context }) => required(context.record.receipt),
	invoke: { id: 'observe', src: 'observe', input: ({ context }) => required(context.record.input) },
	on: {
		START: ({ context, event }, enq) =>
			enq(event.call.report, refused(event.call, required(context.record.input))),
		KEEPERS: ({ context, event }) => ({
			context: { record: { ...context.record, retained: event.count } }
		}),
		DONE: ({ context, event }, enq) => {
			const slot = context.record.slots.find((slot) => slot.call.operationId === event.operationId)
			if (!slot) return
			enq.stop(slot.subscription)
			enq.stop(slot.child)
			enq(slot.call.report, event.result)
			enq(required(context.record.input).track, event.operationId, undefined)
			return {
				context: {
					record: {
						...context.record,
						slots: context.record.slots.filter((candidate) => candidate !== slot)
					}
				}
			}
		}
	},
	states: {
		active: {
			on: {
				START: ({ context, event }, enq) => {
					const input = required(context.record.input),
						call = event.call
					if (context.record.slots.length >= 8) {
						enq(call.report, refused(call, input))
						return
					}
					const ledger = createAccountWriteLedger()
					enq(input.track, call.operationId, ledger)
					const child = enq.spawn('update', {
						id: call.operationId,
						input: {
							...input,
							operationId: call.operationId,
							scope: input.storage.host.identity.scope,
							transform: call.transform,
							ledger,
							report: call.report
						}
					})
					const subscription = enq.subscribeTo(child, {
						done: (result) => ({ type: 'DONE', operationId: call.operationId, result }),
						error: () => {
							ledger.handoff()
							return {
								type: 'DONE',
								operationId: call.operationId,
								result: {
									...refused(call, input),
									writeOutcome: ledger.receipt ? 'unknown' : 'not-issued'
								}
							}
						}
					})
					return {
						context: {
							record: {
								...context.record,
								slots: [...context.record.slots, { call, child, subscription, ledger }]
							}
						}
					}
				},
				SHUTDOWN: ({ context }, enq) => {
					for (const slot of context.record.slots) enq.sendTo(slot.child, { type: 'SHUTDOWN' })
					return { target: 'draining' }
				}
			}
		},
		draining: {
			always: ({ context }) =>
				context.record.slots.length === 0 && context.record.retained === 0
					? { target: 'closingTransport' }
					: undefined
		},
		closingTransport: {
			invoke: {
				id: 'close',
				src: 'close',
				input: ({ context }) => required(context.record.input).storage,
				onDone: ({ context, event }) =>
					event.output.scope === required(context.record.input).storage.host.identity.scope &&
					event.output.requestId === required(context.record.input).storage.host.identity.requestId
						? {
								target: 'closed',
								context: { record: { ...context.record, receipt: event.output } }
							}
						: { target: 'blocked' },
				onError: { target: 'blocked' }
			}
		},
		blocked: {
			entry: ({ context }, enq) =>
				enq(
					required(context.record.input).onOverdue,
					required(context.record.input).storage.host.identity.requestId
				)
		},
		closed: {
			type: 'final',
			entry: ({ context }) => ({ context: { record: { ...context.record, input: undefined } } })
		}
	}
})

export type ScopedAccountStoreOptions = {
	clock?: ActorOptions<typeof ownerMachine>['clock']
	deadlineMs?: number
	operation?: typeof scopedAccountUpdateMachine
	onOverdue: (operationId: string) => void
}
/** Explicit SDK/worker boundary. One owner admits bounded operations. Its native
 * custody recipient outlives a forced owner stop and never restarts an update. */
export function createScopedWorkerAccountStore(
	key: string,
	storage: Storage,
	options: ScopedAccountStoreOptions
): AccountStore & { close: () => Promise<WorkerHostClosed>; dispose: () => void } {
	const keepers = new Set<ActorRefFrom<typeof accountWriteCustodyMachine>>()
	const observers = new Set<(count: number) => void>()
	const ledgers = new Map<string, AccountWriteLedger>()
	const pending = new Map<string, (result: AccountOperationResult) => void>()
	const closed = Promise.withResolvers<WorkerHostClosed>()
	void closed.promise.catch(() => {})
	const publish = () => {
		for (const report of observers) report(keepers.size)
	}
	const retain = (custody: DetachedAccountWrite) => {
		const keeper = createActor(accountWriteCustodyMachine, {
			input: custody,
			...(options.clock ? { clock: options.clock } : {})
		})
		keepers.add(keeper)
		publish()
		keeper.subscribe({
			complete: () => {
				if (!keeper.getSnapshot().output) {
					options.onOverdue(custody.operationId)
					return
				}
				keepers.delete(keeper)
				publish()
			},
			error: () => options.onOverdue(custody.operationId)
		})
		keeper.start()
	}
	const logic = options.operation
		? ownerMachine.provide({ actors: { update: options.operation } })
		: ownerMachine
	const owner = createActor(logic, {
		...(options.clock ? { clock: options.clock } : {}),
		input: {
			key,
			track: (id, ledger) => {
				if (ledger) ledgers.set(id, ledger)
				else ledgers.delete(id)
			},
			storage,
			deadlineMs: options.deadlineMs ?? 10_000,
			retain,
			onOverdue: options.onOverdue,
			observeKeepers: (report) => {
				observers.add(report)
				report(keepers.size)
				return () => observers.delete(report)
			}
		}
	})
	const failPending = () => {
		for (const [operationId, report] of pending)
			report({
				operationId,
				scope: storage.host.identity.scope,
				ok: false,
				writeOutcome:
					ledgers.get(operationId)?.outcome ??
					(ledgers.get(operationId)?.receipt ? 'unknown' : 'not-issued')
			})
	}
	owner.subscribe({
		complete: () => {
			const receipt = owner.getSnapshot().output
			if (receipt) closed.resolve(receipt)
		},
		error: () => {
			for (const ledger of ledgers.values()) ledger.handoff()
			failPending()
			observers.clear()
			ledgers.clear()
			closed.reject(new Error('Account storage update failed'))
		}
	})
	owner.start()
	return {
		read: storage.read,
		update: (transform) => {
			if (owner.getSnapshot().status !== 'active')
				return Promise.reject(
					Object.assign(new Error('Account storage update failed'), {
						ok: false,
						writeOutcome: 'not-issued',
						scope: storage.host.identity.scope
					})
				)
			const operationId = crypto.randomUUID()
			return new Promise<void>((resolve, reject) => {
				const report = (result: AccountOperationResult) => {
					if (!pending.delete(operationId)) return
					if (result.ok) resolve()
					else reject(Object.assign(new Error('Account storage update failed'), result))
				}
				pending.set(operationId, report)
				owner.send({ type: 'START', call: { operationId, transform, report } })
			})
		},
		close: () => {
			if (owner.getSnapshot().status === 'active') owner.send({ type: 'SHUTDOWN' })
			return closed.promise
		},
		dispose: () => {
			for (const ledger of ledgers.values()) ledger.handoff()
			failPending()
			owner.stop()
			observers.clear()
			ledgers.clear()
			closed.reject(new Error('Account storage update failed'))
		}
	}
}
