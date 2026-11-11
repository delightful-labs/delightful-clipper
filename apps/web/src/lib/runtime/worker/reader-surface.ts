import { z } from 'zod'
import type { ReaderSurface } from '../../reader/surface.js'
const disposedReply = z.object({ type: z.literal('DISPOSED'), id: z.string().uuid() }).strict()
const nativeReply = z.object({
	type: z.literal('FULLSCREEN'),
	id: z.string().uuid().optional(),
	supported: z.boolean(),
	active: z.boolean(),
	ok: z.boolean()
})
/** Native facts and handles only. Domain focus/exit/viewport ownership remains in
 * the reader chart; a port cannot choose or perform a persistence operation. */
export function remoteReaderSurface(
	port: MessagePort,
	initial: { supported: boolean; active: boolean }
): ReaderSurface & { dispose: () => void; close: () => Promise<void>; detach: () => void } {
	let facts = initial
	let disposed = false,
		closing = false,
		acknowledged = false
	const closeId = crypto.randomUUID(),
		closed = Promise.withResolvers<void>()
	void closed.promise.catch(() => {})
	const observers = new Set<() => void>()
	const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
	const receive = ({ data }: MessageEvent<unknown>) => {
		const receipt = disposedReply.safeParse(data)
		if (closing && receipt.success && receipt.data.id === closeId) {
			acknowledged = true
			closed.resolve()
			return
		}
		const parsed = nativeReply.safeParse(data)
		if (!parsed.success) return
		facts = parsed.data
		const reply = parsed.data
		const call = reply.id ? pending.get(reply.id) : undefined
		if (reply.id) pending.delete(reply.id)
		if (call) {
			if (reply.ok) call.resolve()
			else call.reject(new Error('Fullscreen unavailable'))
		} else for (const observe of observers) observe()
	}
	port.addEventListener('message', receive)
	port.start()
	const request = (type: 'FULLSCREEN_ENTER' | 'FULLSCREEN_EXIT') =>
		new Promise<void>((resolve, reject) => {
			const id = crypto.randomUUID()
			pending.set(id, { resolve, reject })
			port.postMessage({ type, id })
		})
	return {
		viewport: { port },
		fullscreen: {
			supported: () => facts.supported,
			active: () => facts.active,
			enter: () => request('FULLSCREEN_ENTER'),
			exit: () => request('FULLSCREEN_EXIT'),
			observe: (changed) => {
				observers.add(changed)
				return () => {
					observers.delete(changed)
				}
			}
		},
		detach: () => port.postMessage({ type: 'DETACH' }),
		close: () => {
			if (!closing && !disposed) {
				closing = true
				port.postMessage({ type: 'DISPOSE', id: closeId })
			}
			return closed.promise
		},
		dispose: () => {
			if (disposed) return
			disposed = true
			closed.reject(new Error('Reader surface closed'))
			for (const call of pending.values()) call.reject(new Error('Reader surface closed'))
			pending.clear()
			observers.clear()
			port.removeEventListener('message', receive)
			if (!acknowledged) {
				try {
					port.postMessage({ type: 'DISPOSE' })
				} catch {
					/* Disruptive disposal is not closure proof. */
				}
			}
			port.close()
		}
	}
}
