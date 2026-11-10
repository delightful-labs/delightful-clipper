import { createActor, toPromise } from 'xstate'
import { authRequestMachine, type Auth } from './request-machine.js'

/** HTTP boundary owns one request root; it is never attached to actor inspection. */
export async function handleConfiguredAuth(
	auth: Auth,
	request: Request,
	config: { origin: string; secret: string }
) {
	const actor = createActor(authRequestMachine, {
		input: { auth, request, config, disconnected: request.signal.aborted }
	})
	const disconnect = () => actor.send({ type: 'DISCONNECT' })
	request.signal.addEventListener('abort', disconnect, { once: true })
	try {
		const result = await toPromise(actor.start())
		if (result.kind === 'response' && request.signal.aborted)
			await result.response.body?.cancel().catch(() => {})
		if (result.kind === 'disconnected' || request.signal.aborted)
			throw new DOMException('Authentication request disconnected', 'AbortError')
		return result.response
	} finally {
		request.signal.removeEventListener('abort', disconnect)
		actor.stop()
	}
}
