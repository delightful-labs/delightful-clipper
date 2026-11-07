import { z } from 'zod'
import type { ReaderSurface } from '../../reader/surface.js'
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
): ReaderSurface & { dispose: () => void } {
	let facts = initial
	const observers = new Set<() => void>()
	const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
	const receive = ({ data }: MessageEvent<unknown>) => {
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
		dispose: () => {
			for (const call of pending.values()) call.reject(new Error('Reader surface closed'))
			pending.clear()
			observers.clear()
			port.removeEventListener('message', receive)
			port.postMessage({ type: 'DISPOSE' })
			port.close()
		}
	}
}
