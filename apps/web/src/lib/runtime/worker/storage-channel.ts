import { z } from 'zod'
export const ACCOUNT_STORAGE_PREFIX = 'jazz-account-selection-v2:'
export function accountStorageKey(serverUrl: string) {
	return `${ACCOUNT_STORAGE_PREFIX}${encodeURIComponent(new URL(serverUrl).href)}:clipper`
}
const id = z.string().uuid()
const request = z.discriminatedUnion('type', [
	z.object({ type: z.literal('READ'), id }),
	z.object({ type: z.literal('WRITE'), id, value: z.string().max(1024 * 1024) })
])
const response = z.discriminatedUnion('type', [
	z.object({ type: z.literal('RESULT'), id, value: z.string().nullable() }),
	z.object({ type: z.literal('FAILED'), id })
])
/** Window-only compatibility leaf. No identity policy, locks, transforms or Jazz
 * runtime executes here. The worker owns every read/transform/write operation. */
export function serveAccountStorage(
	port: MessagePort,
	storage: Pick<Storage, 'getItem' | 'setItem'>,
	key: string
) {
	const read = () => storage.getItem(key)
	const write = (value: string) => {
		storage.setItem(key, value)
		return null
	}
	port.onmessage = ({ data }: MessageEvent<unknown>) => {
		const decoded = request.safeParse(data)
		if (!decoded.success) return
		const message = decoded.data
		try {
			const value = message.type === 'READ' ? read() : write(message.value)
			port.postMessage({ type: 'RESULT', id: message.id, value })
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
/** Private port, one fixed store namespace; replies never enter rendered views. */
export function accountStorageClient(port: MessagePort) {
	let closed = false
	const pending = new Map<
		string,
		{ resolve: (value: string | null) => void; reject: (reason: Error) => void }
	>()
	port.onmessage = ({ data }: MessageEvent<unknown>) => {
		const decoded = response.safeParse(data)
		if (!decoded.success) return
		const message = decoded.data,
			call = pending.get(message.id)
		if (!call) return
		pending.delete(message.id)
		if (message.type === 'RESULT') call.resolve(message.value)
		else call.reject(new Error('Account storage unavailable'))
	}
	port.onmessageerror = close
	port.start()
	function close() {
		closed = true
		for (const call of pending.values()) call.reject(new Error('Account storage closed'))
		pending.clear()
		port.close()
	}
	function call(message: { type: 'READ' } | { type: 'WRITE'; value: string }) {
		const id = crypto.randomUUID()
		return new Promise<string | null>((resolve, reject) => {
			if (closed) {
				reject(new Error('Account storage closed'))
				return
			}
			pending.set(id, { resolve, reject })
			try {
				port.postMessage({ ...message, id })
			} catch {
				pending.delete(id)
				reject(new Error('Account storage unavailable'))
			}
		})
	}
	return {
		read: () => call({ type: 'READ' }),
		write: async (value: string) => {
			await call({ type: 'WRITE', value })
		},
		close
	}
}
