import { serveBrokerHost } from '../../src/lib/runtime/worker/broker-channel.js'

/** Actual Window primitives and dedicated/SharedWorkers. Delay only native
 * delivery: no substitute broker/request owner or synthetic settlement proof. */
export async function qualifyBroker(late: boolean) {
	const data = new MessageChannel(),
		control = new MessageChannel()
	const worker = new Worker(new URL('./broker.worker.ts', import.meta.url), { type: 'module' })
	const scope = crypto.randomUUID(),
		name = `jazz-runtime:broker-qualification:${scope}`
	const key = `jazz:shared-worker-generation:${name}`
	localStorage.setItem(key, '4')
	let opens = 0,
		writes = 0,
		wrongReceiptIgnored = false,
		done = false
	let heldOpen: { message: unknown; transfers: Transferable[] } | undefined
	let heldClose: unknown, heldReceipt: unknown
	const postData = data.port1.postMessage.bind(data.port1)
	const postControl = control.port1.postMessage.bind(control.port1)
	if (late) {
		data.port1.postMessage = (message, transfers) => {
			heldOpen = { message, transfers: Array.isArray(transfers) ? transfers : [] }
			worker.postMessage({ type: 'TICK', ms: 5 })
		}
		control.port1.addEventListener('message', (event) => {
			if (!heldClose) {
				event.stopImmediatePropagation()
				heldClose = event.data
				if (!heldOpen) throw new Error('Missing held broker reply')
				postData(heldOpen.message, heldOpen.transfers)
			}
		})
		control.port1.postMessage = (message) => {
			heldReceipt = message
			worker.postMessage({ type: 'TICK', ms: 10 })
		}
	}
	const release = serveBrokerHost(data.port1, control.port1, scope, {
		origin: location.origin,
		storage: {
			getItem: (key) => localStorage.getItem(key),
			setItem: (key, value) => {
				writes++
				localStorage.setItem(key, value)
			}
		},
		open: (url, name) => {
			opens++
			return new SharedWorker(url, { type: 'module', name })
		}
	})
	let timer: ReturnType<typeof setTimeout> | undefined
	try {
		const result = await new Promise<Record<string, unknown>>((resolve, reject) => {
			timer = setTimeout(() => reject(new Error('Broker qualification deadline exceeded')), 5000)
			worker.onerror = () => reject(new Error('Broker fixture Worker failed'))
			worker.onmessage = ({ data: message }) => {
				if (message.type === 'ERROR') reject(new Error('Broker qualification failed'))
				if (message.type === 'DISCARDED')
					control.port1.dispatchEvent(new MessageEvent('message', { data: heldClose }))
				if (message.type === 'OVERDUE')
					postControl({ version: 1, type: 'HOST_CLOSED', scope, requestId: crypto.randomUUID() })
				if (message.type === 'WRONG_SEEN') {
					wrongReceiptIgnored = !done
					postControl(heldReceipt)
				}
				if (message.type === 'DONE') {
					done = true
					resolve(message.result)
				}
			}
			worker.postMessage(
				{
					type: 'START',
					data: data.port2,
					control: control.port2,
					scope,
					key,
					name,
					url: new URL('./broker.sharedworker.ts', import.meta.url).href,
					late
				},
				[data.port2, control.port2]
			)
		})
		return { ...result, opens, writes, ...(late ? { wrongReceiptIgnored } : {}) }
	} finally {
		clearTimeout(timer)
		release()
		worker.terminate()
		localStorage.removeItem(key)
	}
}
