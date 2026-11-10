import { z } from 'zod'
import { createActor, type ActorOptions } from 'xstate'
import type { RuntimeSourcesConfig } from 'jazz-tools'
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

const MAX_HOST_BROKERS = 32
const key = z.string().startsWith('jazz:shared-worker-generation:jazz-runtime:').max(65536)
const generation = z
	.string()
	.regex(/^\d{1,16}$/)
	.refine((value) => Number.isSafeInteger(Number(value)))
const correlation = hostEnvelopeSchema.extend({
	sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER)
})
const payload = z.discriminatedUnion('type', [
	z
		.object({
			type: z.literal('OPEN'),
			url: z.string().url().max(8192),
			name: z.string().startsWith('jazz-runtime:').max(65536)
		})
		.strict(),
	z.object({ type: z.literal('READ'), key }).strict(),
	z.object({ type: z.literal('WRITE'), key, value: generation }).strict()
])
const request = z.discriminatedUnion('type', [
	correlation.extend(payload.options[0].shape).strict(),
	correlation.extend(payload.options[1].shape).strict(),
	correlation.extend(payload.options[2].shape).strict()
])
const portPayload = z.object({ port: z.instanceof(MessagePort) })
const replyPayload = z.discriminatedUnion('type', [
	portPayload.extend({ type: z.literal('OPENED') }).strict(),
	z.object({ type: z.literal('RESULT'), value: z.string().max(65536).nullable() }).strict()
])
const response = z.discriminatedUnion('type', [
	correlation.extend(replyPayload.options[0].shape).strict(),
	correlation.extend(replyPayload.options[1].shape).strict(),
	correlation
		.extend({
			type: z.literal('FAILED'),
			reason: z.enum(['rejected', 'unavailable']),
			effectOutcome: z.enum(['not-issued', 'unknown'])
		})
		.strict()
])
const hostFailed = z
	.object({
		version: z.literal(WORKER_HOST_PROTOCOL_VERSION),
		scope: hostScopeSchema,
		type: z.literal('HOST_FAILED')
	})
	.strict()
type Payload = z.infer<typeof payload>
type Reply = z.infer<typeof replyPayload>
type BrokerHandle = Pick<SharedWorker, 'port' | 'addEventListener' | 'removeEventListener'>
export type BrokerHostNative = {
	origin: string
	storage: Pick<Storage, 'getItem' | 'setItem'>
	open: (url: string, name: string) => BrokerHandle
}

/** Window primitives only. Jazz in the Worker chooses URL/name and generations.
 * The independent control lease survives native data failure and starts at mount. */
export function serveBrokerHost(
	dataPort: MessagePort,
	controlPort: MessagePort,
	scope: string,
	native: BrokerHostNative
) {
	hostScopeSchema.parse(scope)
	const workers = new Set<BrokerHandle>()
	let disposed = false,
		sequence = 0
	function closeData() {
		if (disposed) return
		disposed = true
		dataPort.removeEventListener('message', receive)
		dataPort.removeEventListener('messageerror', failed)
		for (const worker of workers) worker.removeEventListener('error', failed)
		workers.clear()
		dataPort.close()
	}
	function failed() {
		if (disposed) return
		try {
			dataPort.postMessage({ version: WORKER_HOST_PROTOCOL_VERSION, scope, type: 'HOST_FAILED' })
		} catch {
			// A failed post cannot prove closure. Independent control remains live.
		} finally {
			closeData()
		}
	}
	function reply(message: z.infer<typeof response>, transfers: MessagePort[] = []) {
		try {
			dataPort.postMessage(message, transfers)
		} catch {
			for (const resource of transfers) resource.close()
			closeData()
		}
	}
	function receive(event: MessageEvent<unknown>) {
		for (const resource of event.ports) resource.close()
		if (disposed || event.ports.length) return
		const decoded = request.safeParse(event.data)
		if (!decoded.success || decoded.data.scope !== scope) return
		const message = decoded.data
		const identity: z.infer<typeof correlation> = {
			version: WORKER_HOST_PROTOCOL_VERSION,
			scope,
			requestId: message.requestId,
			sequence: message.sequence
		}
		if (message.sequence !== sequence + 1) {
			reply({ ...identity, type: 'FAILED', reason: 'rejected', effectOutcome: 'not-issued' })
			return
		}
		// Consume before the fallible primitive; duplicates cannot repeat effects.
		sequence = message.sequence
		try {
			if (message.type === 'OPEN') {
				const url = new URL(message.url)
				if (url.origin !== native.origin || url.username || url.password) {
					reply({ ...identity, type: 'FAILED', reason: 'rejected', effectOutcome: 'not-issued' })
					return
				}
				if (workers.size >= MAX_HOST_BROKERS) {
					reply({ ...identity, type: 'FAILED', reason: 'unavailable', effectOutcome: 'not-issued' })
					return
				}
				const worker = native.open(message.url, message.name)
				try {
					workers.add(worker)
					worker.addEventListener('error', failed)
				} catch {
					worker.port.close()
					throw new Error('Broker host unavailable')
				}
				reply({ ...identity, type: 'OPENED', port: worker.port }, [worker.port])
				return
			}
			if (message.type === 'READ') {
				const value = replyPayload.options[1].shape.value.parse(native.storage.getItem(message.key))
				reply({ ...identity, type: 'RESULT', value })
				return
			}
			native.storage.setItem(message.key, message.value)
			reply({ ...identity, type: 'RESULT', value: null })
		} catch {
			reply({
				...identity,
				type: 'FAILED',
				reason: 'unavailable',
				effectOutcome: message.type === 'READ' ? 'not-issued' : 'unknown'
			})
		}
	}
	dataPort.addEventListener('message', receive)
	dataPort.addEventListener('messageerror', failed)
	dataPort.start()
	const closeControl = serveHostClose(controlPort, scope, closeData)
	return () => {
		closeData()
		closeControl()
	}
}

/** Close every unaccepted native handle, including malformed payload handles.
 * Successful OPENED delivery transfers exactly one port into DLF's custody. */
function discardTransfers(event: MessageEvent<unknown>, accepted?: MessagePort) {
	const resources = new Set(event.ports)
	const decoded = portPayload.safeParse(event.data)
	if (decoded.success) resources.add(decoded.data.port)
	for (const resource of resources) if (resource !== accepted) resource.close()
}
function accepts(message: Payload, reply: Reply) {
	if (message.type === 'OPEN') return reply.type === 'OPENED'
	return reply.type === 'RESULT' && (message.type === 'READ' || reply.value === null)
}
type Failed = Exclude<WorkerChannelResult<Reply>, { kind: 'succeeded' }>
function failure(result: Failed) {
	return Object.assign(
		new Error(result.reason === 'closed' ? 'Broker host closed' : 'Broker host unavailable'),
		{
			workerEffectOutcome: result.effectOutcome,
			workerRequest: result.kind === 'failed' ? result.identity : undefined
		}
	)
}
export type BrokerHostOptions = {
	clock?: ActorOptions<ReturnType<typeof createWorkerChannel<Payload, Reply>>>['clock']
	requestTimeoutMs?: number
	closeTimeoutMs?: number
	onOverdue: () => void
	onBlocked: () => void
}
/** One root at Worker initialization. The shared DLF chart owns concurrency,
 * request settlement and host closure; the promise facade selects no retries. */
export function brokerHostClient(
	dataPort: MessagePort,
	controlPort: MessagePort,
	scope: string,
	options: BrokerHostOptions
) {
	hostScopeSchema.parse(scope)
	const control = workerHostControl(controlPort, scope)
	const identity = { scope, requestId: crypto.randomUUID() }
	const closed = Promise.withResolvers<WorkerHostClosed>()
	void closed.promise.catch(() => {})
	const actor = createActor(createWorkerChannel<Payload, Reply>(), {
		...(options.clock ? { clock: options.clock } : {}),
		input: {
			scope,
			closeRequestId: identity.requestId,
			...(options.requestTimeoutMs === undefined
				? {}
				: { requestTimeoutMs: options.requestTimeoutMs }),
			...(options.closeTimeoutMs === undefined ? {} : { closeTimeoutMs: options.closeTimeoutMs }),
			post(message, correlation) {
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
					const lost = hostFailed.safeParse(event.data)
					if (lost.success) {
						discardTransfers(event)
						if (lost.data.scope === scope) failed()
						return
					}
					const decoded = response.safeParse(event.data)
					if (!decoded.success) {
						discardTransfers(event)
						report({ type: 'TRANSPORT_FAILED', scope, reason: 'invalid-reply' })
						return
					}
					const message = decoded.data
					const opened = message.type === 'OPENED'
					if (
						opened
							? event.ports.length !== 1 || event.ports[0] !== message.port
							: event.ports.length !== 0
					) {
						discardTransfers(event)
						report({ type: 'TRANSPORT_FAILED', scope, reason: 'invalid-reply' })
						return
					}
					const requestIdentity = {
						scope: message.scope,
						requestId: message.requestId,
						sequence: message.sequence
					}
					report({
						type: 'REPLY',
						reply:
							message.type === 'FAILED'
								? {
										kind: 'failed',
										identity: requestIdentity,
										reason: message.reason,
										effectOutcome: message.effectOutcome
									}
								: {
										kind: 'succeeded',
										identity: requestIdentity,
										response: opened
											? { type: 'OPENED', port: message.port }
											: { type: 'RESULT', value: message.value }
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
			discard: (reply) => {
				if (reply.type === 'OPENED') reply.port.close()
			},
			onOverdue: options.onOverdue,
			onBlocked: options.onBlocked
		}
	})
	actor.subscribe({
		complete: () => {
			const receipt = actor.getSnapshot().output
			if (receipt) closed.resolve(receipt)
		},
		error: () => closed.reject(new Error('Broker host closed'))
	})
	actor.start()
	function call(selected: Payload) {
		const decoded = payload.safeParse(selected)
		if (!decoded.success || actor.getSnapshot().status !== 'active')
			return Promise.reject(
				Object.assign(new Error('Broker host unavailable'), { workerEffectOutcome: 'not-issued' })
			)
		const message = decoded.data
		return new Promise<Reply>((resolve, reject) =>
			actor.send({
				type: 'REQUEST',
				call: {
					requestId: crypto.randomUUID(),
					request: message,
					effect: message.type === 'READ' ? 'query' : 'effect',
					accept: (reply) => accepts(message, reply),
					settle: (result) =>
						result.kind === 'succeeded' ? resolve(result.response) : reject(failure(result))
				}
			})
		)
	}
	const sdk = {
		open: async (url: string, name: string) => {
			const reply = await call({ type: 'OPEN', url, name })
			if (reply.type !== 'OPENED') throw new Error('Broker port unavailable')
			return { port: reply.port }
		},
		readGeneration: async (key: string) => {
			const reply = await call({ type: 'READ', key })
			if (reply.type !== 'RESULT') throw new Error('Broker generation unavailable')
			return reply.value
		},
		writeGeneration: async (key: string, value: string) => {
			await call({ type: 'WRITE', key, value })
		}
	} satisfies NonNullable<RuntimeSourcesConfig['browserWorkerHost']>
	return {
		...sdk,
		host: { identity, closed: closed.promise },
		close: () => {
			if (actor.getSnapshot().status === 'active') actor.send({ type: 'CLOSE' })
			return closed.promise
		},
		/** Disruptive teardown is not a receipt of host closure. */
		dispose: () => {
			actor.stop()
			closed.reject(new Error('Broker host closed'))
		}
	}
}
