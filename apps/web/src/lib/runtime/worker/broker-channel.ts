import { z } from 'zod'

const id = z.string().uuid()
const key = z.string().startsWith('jazz:shared-worker-generation:jazz-runtime:').max(65536)
const request = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('OPEN'),
		id,
		url: z.string().url(),
		name: z.string().startsWith('jazz-runtime:').max(65536)
	}),
	z.object({ type: z.literal('READ'), id, key }),
	z.object({ type: z.literal('WRITE'), id, key, value: z.string().regex(/^\d{1,16}$/) })
])
const response = z.discriminatedUnion('type', [
	z.object({ type: z.literal('OPENED'), id, port: z.instanceof(MessagePort) }),
	z.object({ type: z.literal('RESULT'), id, value: z.string().nullable() }),
	z.object({ type: z.literal('FAILED'), id })
])
type Reply = z.infer<typeof response>

/** Native Window primitives only. Jazz owns namespaces, generations and admission
 * in the dedicated worker. No broker protocol or database work runs here. */
export function serveBrokerHost(port: MessagePort) {
	port.onmessage = ({ data }: MessageEvent<unknown>) => {
		const decoded = request.safeParse(data)
		if (!decoded.success) return
		const message = decoded.data
		try {
			switch (message.type) {
				case 'OPEN': {
					if (new URL(message.url).origin !== location.origin)
						throw new Error('Invalid broker origin')
					const worker = new SharedWorker(message.url, { type: 'module', name: message.name })
					port.postMessage({ type: 'OPENED', id: message.id, port: worker.port }, [worker.port])
					break
				}
				case 'READ':
					port.postMessage({
						type: 'RESULT',
						id: message.id,
						value: localStorage.getItem(message.key)
					})
					break
				case 'WRITE':
					localStorage.setItem(message.key, message.value)
					port.postMessage({ type: 'RESULT', id: message.id, value: null })
			}
		} catch {
			port.postMessage({ type: 'FAILED', id: message.id })
		}
	}
	port.start()
	return () => {
		port.onmessage = null
		port.close()
	}
}

/** Dedicated-worker client. The host handle stays private to the SDK and is
 * stripped before its configuration crosses into the persistent broker. */
export function brokerHostClient(port: MessagePort) {
	const pending = new Map<
		string,
		{ resolve: (reply: Reply) => void; reject: (reason: Error) => void }
	>()
	let closed = false
	port.onmessage = ({ data }: MessageEvent<unknown>) => {
		const decoded = response.safeParse(data)
		if (!decoded.success) return
		const message = decoded.data
		const call = pending.get(message.id)
		if (!call) {
			if (message.type === 'OPENED') message.port.close()
			return
		}
		pending.delete(message.id)
		if (message.type === 'FAILED') call.reject(new Error('Broker host unavailable'))
		else call.resolve(message)
	}
	function close() {
		closed = true
		for (const call of pending.values()) call.reject(new Error('Broker host closed'))
		pending.clear()
		port.close()
	}
	port.onmessageerror = close
	port.start()
	function call(
		message:
			| { type: 'OPEN'; url: string; name: string }
			| { type: 'READ'; key: string }
			| { type: 'WRITE'; key: string; value: string }
	) {
		return new Promise<Reply>((resolve, reject) => {
			if (closed) {
				reject(new Error('Broker host closed'))
				return
			}
			const id = crypto.randomUUID()
			pending.set(id, { resolve, reject })
			try {
				port.postMessage({ ...message, id })
			} catch {
				pending.delete(id)
				reject(new Error('Broker host unavailable'))
			}
		})
	}
	return {
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
		},
		close
	}
}
