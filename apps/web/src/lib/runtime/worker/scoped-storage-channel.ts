import { z } from 'zod'
import { createActor, type ActorOptions } from 'xstate'
import { createWorkerChannel } from 'delightful-local-first/worker/channel/workflow'
import type {
	WorkerChannelResult,
	WorkerHostClosed
} from 'delightful-local-first/worker/channel/contracts'
import {
	serveHostClose,
	workerHostControl,
	hostScopeSchema,
	hostEnvelopeSchema,
	WORKER_HOST_PROTOCOL_VERSION
} from './host-close-channel.js'

const MAX_ACCOUNT_VALUE_LENGTH = 1024 * 1024
const accountValueSchema = z.string().max(MAX_ACCOUNT_VALUE_LENGTH)
const identity = hostEnvelopeSchema.extend({
	sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
})
const payload = z.discriminatedUnion('type', [
	z.object({ type: z.literal('READ') }).strict(),
	z.object({ type: z.literal('WRITE'), value: accountValueSchema }).strict()
])
const request = z.discriminatedUnion('type', [
	identity.extend(payload.options[0].shape).strict(),
	identity.extend(payload.options[1].shape).strict()
])
const response = z.discriminatedUnion('type', [
	identity
		.extend({
			type: z.literal('RESULT'),
			value: accountValueSchema.nullable()
		})
		.strict(),
	identity
		.extend({
			type: z.literal('FAILED'),
			reason: z.enum(['unavailable', 'invalid-reply']),
			effectOutcome: z.enum(['not-issued', 'unknown'])
		})
		.strict()
])
type Payload = z.infer<typeof payload>
type Response = { value: string | null }

/** Synchronous Window primitives bound to one existing key. Scope/sequence are
 * native capability validation; account selection and transforms stay in Worker. */
function serveStorageData(
	dataPort: MessagePort,
	scope: string,
	storage: Pick<Storage, 'getItem' | 'setItem'>,
	key: string
) {
	hostScopeSchema.parse(scope)
	let disposed = false,
		sequence = 0
	const write = (value: string) => {
		storage.setItem(key, value)
		return null
	}
	function postReply(message: unknown) {
		try {
			dataPort.postMessage(message)
		} catch {
			disposeData()
		}
	}
	const receive = (event: MessageEvent<unknown>) => {
		for (const resource of event.ports) resource.close()
		if (disposed || event.ports.length) return
		const decoded = request.safeParse(event.data)
		if (!decoded.success || decoded.data.scope !== scope) return
		const message = decoded.data
		const correlation = {
			version: WORKER_HOST_PROTOCOL_VERSION,
			scope,
			requestId: message.requestId,
			sequence: message.sequence
		}
		if (message.sequence !== sequence + 1) {
			postReply({
				...correlation,
				type: 'FAILED',
				reason: 'invalid-reply',
				effectOutcome: 'not-issued'
			})
			return
		}
		sequence = message.sequence
		try {
			const value = message.type === 'READ' ? storage.getItem(key) : write(message.value)
			const reply = response.safeParse({ ...correlation, type: 'RESULT', value })
			if (!reply.success) throw new Error('Invalid account storage reply')
			postReply(reply.data)
		} catch {
			postReply({
				...correlation,
				type: 'FAILED',
				reason: 'unavailable',
				effectOutcome: message.type === 'READ' ? 'not-issued' : 'unknown'
			})
		}
	}
	dataPort.addEventListener('message', receive)
	dataPort.start()
	const disposeData = () => {
		if (disposed) return
		disposed = true
		dataPort.removeEventListener('message', receive)
		dataPort.close()
	}
	return disposeData
}

/** The independent close lease exists before Worker chooses the fixed key.
 * Revoking it prevents a late namespace message from recreating a data host. */
export function createScopedStorageHost(
	dataPort: MessagePort,
	controlPort: MessagePort,
	scope: string,
	storage: Pick<Storage, 'getItem' | 'setItem'>
) {
	hostScopeSchema.parse(scope)
	let released = false
	let disposeData: (() => void) | undefined
	const releaseData = () => {
		released = true
		disposeData?.()
		dataPort.close()
	}
	const disposeControl = serveHostClose(controlPort, scope, releaseData)
	return {
		bind(key: string) {
			if (released || disposeData) return false
			disposeData = serveStorageData(dataPort, scope, storage, key)
			return true
		},
		dispose: () => {
			releaseData()
			disposeControl()
		}
	}
}
export function serveScopedAccountStorage(
	dataPort: MessagePort,
	controlPort: MessagePort,
	scope: string,
	storage: Pick<Storage, 'getItem' | 'setItem'>,
	key: string
) {
	const host = createScopedStorageHost(dataPort, controlPort, scope, storage)
	host.bind(key)
	return host.dispose
}

type Failed = Exclude<WorkerChannelResult<Response>, { kind: 'succeeded' }>
function failure(result: Failed) {
	return Object.assign(
		new Error(
			result.reason === 'closed' ? 'Account storage closed' : 'Account storage unavailable'
		),
		{
			workerEffectOutcome: result.effectOutcome,
			workerRequest: result.kind === 'failed' ? result.identity : undefined
		}
	)
}
export type ScopedAccountStorageOptions = {
	clock?: ActorOptions<ReturnType<typeof createWorkerChannel<Payload, Response>>>['clock']
	requestTimeoutMs?: number
	closeTimeoutMs?: number
	onOverdue: () => void
	onBlocked: () => void
}
/** One explicit Worker transport root at startup, never a root per read/write.
 * The existing account owner must retain its lock until host.closed proves drain.
 * Do not pass this transport into the legacy account-store owner. */
export function createScopedAccountStorage(
	dataPort: MessagePort,
	controlPort: MessagePort,
	scope: string,
	options: ScopedAccountStorageOptions
) {
	hostScopeSchema.parse(scope)
	const control = workerHostControl(controlPort, scope)
	const closeIdentity = { scope, requestId: crypto.randomUUID() }
	const closed = Promise.withResolvers<WorkerHostClosed>()
	// A failed root cannot prove closure. Keep rejection observed until its owner
	// attaches the native custody observer.
	void closed.promise.catch(() => {})
	const actor = createActor(createWorkerChannel<Payload, Response>(), {
		...(options.clock ? { clock: options.clock } : {}),
		input: {
			scope,
			closeRequestId: closeIdentity.requestId,
			...(options.requestTimeoutMs === undefined
				? {}
				: { requestTimeoutMs: options.requestTimeoutMs }),
			...(options.closeTimeoutMs === undefined ? {} : { closeTimeoutMs: options.closeTimeoutMs }),
			post: (message, correlation) => {
				try {
					dataPort.postMessage({
						...message,
						...correlation,
						version: WORKER_HOST_PROTOCOL_VERSION
					})
					return { kind: 'posted' }
				} catch {
					return { kind: 'not-issued', reason: 'unavailable' }
				}
			},
			listenData(report) {
				const failed = () => report({ type: 'TRANSPORT_FAILED', scope, reason: 'unavailable' })
				const receive = (event: MessageEvent<unknown>) => {
					for (const resource of event.ports) resource.close()
					const decoded = response.safeParse(event.data)
					if (event.ports.length || !decoded.success) {
						report({ type: 'TRANSPORT_FAILED', scope, reason: 'invalid-reply' })
						return
					}
					const message = decoded.data
					const identity = {
						scope: message.scope,
						requestId: message.requestId,
						sequence: message.sequence
					}
					report({
						type: 'REPLY',
						reply:
							message.type === 'RESULT'
								? { kind: 'succeeded', identity, response: { value: message.value } }
								: {
										kind: 'failed',
										identity,
										reason: message.reason,
										effectOutcome: message.effectOutcome
									}
					})
				}
				dataPort.addEventListener('message', receive)
				dataPort.addEventListener('messageerror', failed)
				dataPort.addEventListener('close', failed)
				dataPort.start()
				return () => {
					dataPort.removeEventListener('message', receive)
					dataPort.removeEventListener('messageerror', failed)
					dataPort.removeEventListener('close', failed)
					dataPort.close()
				}
			},
			listenControl: control.listen,
			postClose: control.post,
			discard: () => {},
			onOverdue: options.onOverdue,
			onBlocked: options.onBlocked
		}
	})
	actor.subscribe({
		complete: () => {
			const receipt = actor.getSnapshot().output
			if (receipt) closed.resolve(receipt)
		},
		error: () => closed.reject(new Error('Account storage closed'))
	})
	actor.start()
	function call(selected: Payload) {
		const decoded = payload.safeParse(selected)
		if (!decoded.success)
			return Promise.reject(
				Object.assign(new Error('Account storage unavailable'), {
					workerEffectOutcome: 'not-issued'
				})
			)
		if (actor.getSnapshot().status !== 'active')
			return Promise.reject(
				Object.assign(new Error('Account storage closed'), { workerEffectOutcome: 'not-issued' })
			)
		const message = decoded.data
		return new Promise<string | null>((resolve, reject) =>
			actor.send({
				type: 'REQUEST',
				call: {
					requestId: crypto.randomUUID(),
					request: message,
					effect: message.type === 'READ' ? 'query' : 'effect',
					accept: (reply) => message.type === 'READ' || reply.value === null,
					settle: (result) =>
						result.kind === 'succeeded' ? resolve(result.response.value) : reject(failure(result))
				}
			})
		)
	}
	return {
		read: () => call({ type: 'READ' }),
		write: async (value: string) => {
			await call({ type: 'WRITE', value })
		},
		host: {
			identity: closeIdentity,
			closed: closed.promise,
			requestClose: () => {
				if (actor.getSnapshot().status === 'active') actor.send({ type: 'CLOSE' })
			}
		},
		close: () => {
			if (actor.getSnapshot().status === 'active') actor.send({ type: 'CLOSE' })
			return closed.promise
		},
		/** Disruptive realm teardown only. Rejection is not a host-close receipt. */
		dispose: () => {
			actor.stop()
			closed.reject(new Error('Account storage closed'))
		}
	}
}
