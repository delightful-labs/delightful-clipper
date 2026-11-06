import { createActor, toPromise } from 'xstate'
import { createCaptureRequestMachine } from '../../machines/capture/request.js'
import { createGatewayMachine } from '../../machines/capture/gateway.js'
import { resolveDestination } from './destination.js'
import { fetchHop } from './transport.js'
import { extractInWorker } from './parser.js'
import { acquireCapture } from './admission.js'
import { readCaptureInput } from './request-io.js'
const machine = createCaptureRequestMachine({
	acquire: acquireCapture,
	read: readCaptureInput,
	now: () => performance.now(),
	gateway: createGatewayMachine({
		resolve: resolveDestination,
		fetch: fetchHop,
		extract: extractInWorker
	})
})
/** HTTP binding only; request policy, deadline, gateway ownership and release live in the machine. */
export async function capture(
	request: Request,
	accountId: string | undefined,
	mode: 'resolve' | 'extract' | 'asset',
	enabled = false
) {
	const actor = createActor(machine, { input: { request, accountId, mode, enabled } }).start()
	try {
		return await toPromise(actor)
	} finally {
		actor.stop()
	}
}
