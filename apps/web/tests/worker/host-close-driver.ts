import {
	serveHostClose,
	workerHostControl
} from '../../src/lib/runtime/worker/host-close-channel.js'
import type { HostCloseIdentity } from '../../src/lib/runtime/worker/host-close-channel.js'

async function bounded<Value>(promise: Promise<Value>) {
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		return await Promise.race([
			promise,
			new Promise<never>((_, reject) => {
				timer = setTimeout(() => reject(new Error('Host-close fixture deadline exceeded')), 2000)
			})
		])
	} finally {
		clearTimeout(timer)
	}
}
/** Actual Window MessagePorts and synchronous host disposal; no SDK/domain work. */
export async function qualifyNativeHostClose() {
	const data = new MessageChannel(),
		control = new MessageChannel(),
		orphan = new MessageChannel()
	const scope = crypto.randomUUID(),
		requestId = crypto.randomUUID()
	const written = Promise.withResolvers<void>(),
		orphanReleased = Promise.withResolvers<void>()
	const receipt = Promise.withResolvers<HostCloseIdentity>()
	let writes = 0,
		writesAtClosure = 0,
		closeCalls = 0,
		orphanReleases = 0,
		failures = 0
	data.port1.onmessage = () => {
		writes++
		data.port1.postMessage('WRITTEN')
	}
	data.port2.onmessage = () => written.resolve()
	data.port1.start()
	data.port2.start()
	// Count actual close calls on received native transfers before validation.
	control.port1.addEventListener('message', (event) => {
		for (const resource of event.ports) {
			const close = resource.close.bind(resource)
			resource.close = () => {
				orphanReleases++
				close()
				orphanReleased.resolve()
			}
		}
	})
	const releaseHost = serveHostClose(control.port1, scope, () => {
		closeCalls++
		writesAtClosure = writes
		data.port1.onmessage = null
		data.port1.close()
	})
	const client = workerHostControl(control.port2, scope)
	const releaseClient = client.listen((report) => {
		if (report.type === 'CLOSE_FAILED') failures++
		else receipt.resolve(report.receipt)
	})
	try {
		control.port2.postMessage(
			{ version: 1, scope, requestId, type: 'CLOSE_HOST', port: orphan.port1 },
			[orphan.port1]
		)
		await bounded(orphanReleased.promise)
		data.port2.postMessage('WRITE')
		await bounded(written.promise)
		control.port2.dispatchEvent(new MessageEvent('messageerror'))
		client.post({ scope, requestId })
		const closed = await bounded(receipt.promise)
		data.port2.postMessage('MUST_NOT_WRITE_AFTER_RECEIPT')
		await new Promise((resolve) => setTimeout(resolve, 50))
		return {
			matchingReceipt: closed.scope === scope && closed.requestId === requestId,
			closeCalls,
			orphanReleases,
			failures,
			firstWriteObserved: writesAtClosure > 0,
			writesAfterReceipt: writes - writesAtClosure
		}
	} finally {
		releaseHost()
		releaseClient()
		data.port1.close()
		data.port2.close()
		orphan.port2.close()
	}
}
