import { z } from 'zod'
import { createAsyncLogic, createCallbackLogic, setup, types } from 'xstate'
import type { ActorRefFrom } from 'xstate'
import { createWorkerEffectDrain } from 'delightful-local-first/worker/effect-drain/workflow'
import type {
	WorkerEffectSettlement,
	WorkerEffectProof
} from 'delightful-local-first/worker/effect-drain/contracts'
import type { WorkerHostClosed } from 'delightful-local-first/worker/channel/contracts'

export type AccountHost = {
	identity: WorkerHostClosed
	closed: Promise<WorkerHostClosed>
	requestClose: () => void
}
export type AccountOperationResult = {
	operationId: string
	scope: string
	ok: boolean
	writeOutcome: 'acknowledged' | 'not-issued' | 'unknown'
}
const notIssued = z.object({ workerEffectOutcome: z.literal('not-issued') })
export function definitelyNotIssued(error: unknown) {
	return notIssued.safeParse(error).success
}
export function validAccountDeadline(value: number) {
	return Number.isSafeInteger(value) && value > 0 && value <= 2_147_483_647
}
export function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing account storage resource')
	return value
}
/** Native receipts only. No account payload, transform or write capability can
 * travel with detached custody. Record before calling the native post boundary. */
export function createAccountWriteLedger() {
	let receipt: Promise<WorkerEffectSettlement> | undefined
	let handoff: (() => void) | undefined
	let abandoned = false
	let outcome: AccountOperationResult['writeOutcome'] | undefined
	return Object.freeze({
		get receipt() {
			return receipt
		},
		get outcome() {
			return outcome
		},
		recordOutcome: (value: AccountOperationResult['writeOutcome']) => {
			outcome = value
		},
		record(next: Promise<WorkerEffectSettlement>) {
			if (abandoned)
				throw Object.assign(new Error('Account storage update failed'), {
					workerEffectOutcome: 'not-issued'
				})
			if (receipt) throw new Error('Account write already issued')
			receipt = next
		},
		bindHandoff: (next: () => void) => {
			if (abandoned) next()
			else handoff = next
		},
		clearHandoff: () => {
			abandoned = true
			handoff = undefined
		},
		handoff: () => {
			abandoned = true
			const transfer = handoff
			handoff = undefined
			transfer?.()
		}
	})
}
export type AccountWriteLedger = ReturnType<typeof createAccountWriteLedger>
/** Capture one selected native call and normalize only its execution evidence.
 * The statechart chooses whether to release, retain or close the host. */
export function issueAccountWrite(ledger: AccountWriteLedger, write: () => Promise<void>) {
	const call = Promise.withResolvers<void>()
	const receipt = call.promise.then<WorkerEffectSettlement, WorkerEffectSettlement>(
		() => {
			ledger.recordOutcome('acknowledged')
			return { kind: 'settled' }
		},
		(error: unknown) => {
			const noIssue = definitelyNotIssued(error)
			ledger.recordOutcome(noIssue ? 'not-issued' : 'unknown')
			return { kind: noIssue ? 'settled' : 'uncertain' }
		}
	)
	ledger.record(receipt)
	try {
		void Promise.resolve(write()).then(call.resolve, call.reject)
	} catch (error) {
		call.reject(error)
	}
	return call.promise
}
export type DetachedAccountWrite = {
	operationId: string
	scope: string
	host: AccountHost
	settlement: Promise<WorkerEffectSettlement>
	/** Resolves only after the actual native lock-request promise has settled. */
	release: () => Promise<void>
	deadlineMs: number
	onOverdue: (operationId: string) => void
}
type CustodyContext = {
	record: {
		input: DetachedAccountWrite | undefined
		operationId: string
		scope: string
		proof: WorkerEffectProof | undefined
		deadlineMs: number
	}
}
const drain = createWorkerEffectDrain()
const release = createAsyncLogic<void, DetachedAccountWrite>({
	run: ({ input }) => input.release()
})
/** The worker-realm custody recipient invokes this keeper after a stopped/error
 * update hands off. Completion proves native release, never SDK update success. */
export const accountWriteCustodyMachine = setup({
	schemas: {
		context: types<CustodyContext>(),
		input: types<DetachedAccountWrite>(),
		output: types<{ operationId: string; scope: string }>(),
		children: {
			drain: types<ActorRefFrom<typeof drain>>(),
			release: types<ActorRefFrom<typeof release>>()
		}
	},
	actors: { drain, release },
	delays: { deadline: ({ context }) => context.record.deadlineMs },
	guards: {
		validBinding: ({ context }: { context: CustodyContext }) =>
			context.record.scope === required(context.record.input).host.identity.scope &&
			validAccountDeadline(context.record.deadlineMs)
	}
}).createMachine({
	id: 'account-write-custody',
	context: ({ input }) => ({
		record: {
			input,
			operationId: input.operationId,
			scope: input.scope,
			proof: undefined,
			deadlineMs: input.deadlineMs
		}
	}),
	initial: 'checking',
	output: ({ context }) => ({
		operationId: context.record.operationId,
		scope: context.record.scope
	}),
	states: {
		checking: {
			type: 'choice',
			choice: (args) =>
				args.guards.validBinding(args) ? { target: 'draining' } : { target: 'blocked' }
		},
		draining: {
			invoke: {
				id: 'drain',
				src: 'drain',
				input: ({ context }) => {
					const input = required(context.record.input)
					return {
						identity: input.host.identity,
						settlement: input.settlement,
						hostClosed: input.host.closed,
						requestClose: input.host.requestClose,
						deadlineMs: input.deadlineMs,
						onOverdue: () => input.onOverdue(input.operationId)
					}
				},
				onDone: ({ context, event }) => ({
					target: 'releasing',
					context: { record: { ...context.record, proof: event.output } }
				}),
				onError: { target: 'blocked' }
			}
		},
		releasing: {
			initial: 'waiting',
			invoke: {
				id: 'release',
				src: 'release',
				input: ({ context }) => required(context.record.input),
				onDone: { target: 'released' },
				onError: { target: 'blocked' }
			},
			states: {
				waiting: { timeout: 'deadline', onTimeout: { target: 'overdue' } },
				overdue: {
					entry: ({ context }, enq) =>
						enq(required(context.record.input).onOverdue, context.record.operationId)
				}
			}
		},
		blocked: {
			entry: ({ context }, enq) =>
				enq(required(context.record.input).onOverdue, context.record.operationId)
		},
		released: {
			type: 'final',
			entry: ({ context }) => ({ context: { record: { ...context.record, input: undefined } } })
		}
	}
})

export type AccountLockInput = {
	key: string
	operationId: string
	scope: string
	host: AccountHost
	ledger: AccountWriteLedger
	deadlineMs: number
	retain: (custody: DetachedAccountWrite) => void
	abandoned: (outcome: AccountOperationResult['writeOutcome']) => void
	onOverdue: (operationId: string) => void
	owner: { subscribe(observer: { error: (error: unknown) => void }): { unsubscribe: () => void } }
}
/** Web Lock primitive and total native custody handoff. The disposer cannot
 * release an issued write; its recipient retains the original native receipts. */
export const scopedAccountLock = createCallbackLogic<{ type: 'RELEASE' }, AccountLockInput>(
	({ input, receive, sendBack }) => {
		const abort = new AbortController(),
			gate = Promise.withResolvers<void>(),
			nativeReleased = Promise.withResolvers<void>()
		let releaseRequested = false,
			disposed = false,
			released = false
		const releaseLock = () => {
			releaseRequested = true
			abort.abort()
			gate.resolve()
			return nativeReleased.promise
		}
		const handoff = () => {
			if (disposed) return
			disposed = true
			input.ledger.clearHandoff()
			const settlement = input.ledger.receipt
			if (!releaseRequested)
				input.abandoned(input.ledger.outcome ?? (settlement ? 'unknown' : 'not-issued'))
			if (!released)
				input.retain({
					operationId: input.operationId,
					scope: input.scope,
					host: input.host,
					settlement: settlement ?? Promise.resolve({ kind: 'settled' }),
					release: releaseLock,
					deadlineMs: input.deadlineMs,
					onOverdue: input.onOverdue
				})
			else void releaseLock()
			if (!released)
				sendBack({
					type: 'LEASE_REVOKED',
					outcome: input.ledger.outcome ?? (settlement ? 'unknown' : 'not-issued')
				})
		}
		input.ledger.bindHandoff(handoff)
		const observer = input.owner.subscribe({ error: handoff })
		if (disposed) {
			released = true
			nativeReleased.resolve()
			return () => observer.unsubscribe()
		}
		receive(() => {
			void releaseLock()
		})
		try {
			void navigator.locks
				.request(input.key, { signal: abort.signal }, async () => {
					if (!releaseRequested && !disposed) sendBack({ type: 'LOCKED' })
					await gate.promise
				})
				.then(
					() => {
						released = true
						nativeReleased.resolve()
						if (!disposed) sendBack({ type: 'RELEASED' })
					},
					() => {
						released = true
						nativeReleased.resolve()
						if (!disposed) sendBack({ type: releaseRequested ? 'RELEASED' : 'LOCK_FAILED' })
					}
				)
		} catch {
			released = true
			nativeReleased.resolve()
			sendBack({ type: 'LOCK_FAILED' })
		}
		return () => {
			observer.unsubscribe()
			handoff()
		}
	}
)
