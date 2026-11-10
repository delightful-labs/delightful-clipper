import { z } from 'zod'

export const WORKER_HOST_PROTOCOL_VERSION = 1
export const hostScopeSchema = z.string().uuid()
export const hostIdentitySchema = z.object({ scope: hostScopeSchema, requestId: z.string().uuid() })
export const hostEnvelopeSchema = hostIdentitySchema.extend({
	version: z.literal(WORKER_HOST_PROTOCOL_VERSION)
})
const closeRequest = hostEnvelopeSchema.extend({ type: z.literal('CLOSE_HOST') }).strict()
const closeReceipt = hostEnvelopeSchema.extend({ type: z.literal('HOST_CLOSED') }).strict()
export type HostCloseIdentity = z.infer<typeof hostIdentitySchema>
export type HostControlReport =
	| { type: 'HOST_CLOSED'; receipt: HostCloseIdentity }
	| { type: 'CLOSE_FAILED'; scope: string }

/** Window native boundary for the shared channel's selected close command.
 * closeHost is the synchronous data-host disposer; it must leave this independent
 * control port alive. Only its successful return permits a close receipt. */
export function serveHostClose(port: MessagePort, scope: string, closeHost: () => void) {
	hostScopeSchema.parse(scope)
	let disposed = false
	const receive = (event: MessageEvent<unknown>) => {
		for (const resource of event.ports) resource.close()
		if (disposed || event.ports.length) return
		const decoded = closeRequest.safeParse(event.data)
		if (!decoded.success || decoded.data.scope !== scope) return
		try {
			closeHost()
			port.postMessage({ ...decoded.data, type: 'HOST_CLOSED' })
		} catch {
			// Native close failure is not evidence of host quiescence. The channel
			// reports its own overdue state and retains custody until a real receipt.
		}
	}
	port.addEventListener('message', receive)
	port.start()
	return () => {
		if (disposed) return
		disposed = true
		port.removeEventListener('message', receive)
		port.close()
	}
}

/** Worker native capabilities only: the shared chart selects posting, deadlines
 * and receipt admission. Transport errors do not remove the late-receipt listener. */
export function workerHostControl(port: MessagePort, scope: string) {
	hostScopeSchema.parse(scope)
	return {
		listen(report: (event: HostControlReport) => void) {
			let disposed = false
			const failed = () => {
				if (!disposed) report({ type: 'CLOSE_FAILED', scope })
			}
			const receive = (event: MessageEvent<unknown>) => {
				for (const resource of event.ports) resource.close()
				if (disposed) return
				const decoded = closeReceipt.safeParse(event.data)
				if (event.ports.length || !decoded.success) {
					failed()
					return
				}
				if (decoded.data.scope !== scope) return
				report({ type: 'HOST_CLOSED', receipt: { scope, requestId: decoded.data.requestId } })
			}
			port.addEventListener('message', receive)
			port.addEventListener('messageerror', failed)
			port.start()
			return () => {
				if (disposed) return
				disposed = true
				port.removeEventListener('message', receive)
				port.removeEventListener('messageerror', failed)
				port.close()
			}
		},
		post(identity: HostCloseIdentity) {
			const decoded = hostIdentitySchema.safeParse(identity)
			if (!decoded.success || decoded.data.scope !== scope)
				throw new Error('Invalid host close identity')
			port.postMessage({
				...decoded.data,
				version: WORKER_HOST_PROTOCOL_VERSION,
				type: 'CLOSE_HOST'
			})
		}
	}
}
