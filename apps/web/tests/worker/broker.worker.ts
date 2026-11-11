/// <reference lib="webworker" />
import { SimulatedClock } from 'xstate'
import { brokerHostClient } from '../../src/lib/runtime/worker/broker-channel.js'

type Start = {
	type: 'START'
	data: MessagePort
	control: MessagePort
	scope: string
	url: string
	name: string
	key: string
	late: boolean
}
const clock = new SimulatedClock()
let client: ReturnType<typeof brokerHostClient> | undefined
let discarded = 0,
	overdue = 0
async function run(input: Start) {
	input.data.addEventListener('message', (event) => {
		for (const port of event.ports) {
			const close = port.close.bind(port)
			port.close = () => {
				discarded++
				close()
				self.postMessage({ type: 'DISCARDED' })
			}
		}
	})
	input.control.addEventListener('message', (event) => {
		if (
			event.data.type === 'HOST_CLOSED' &&
			event.data.requestId !== client?.host.identity.requestId
		)
			self.postMessage({ type: 'WRONG_SEEN' })
	})
	client = brokerHostClient(input.data, input.control, input.scope, {
		clock,
		requestTimeoutMs: 5,
		closeTimeoutMs: 10,
		onOverdue: () => {
			overdue++
			self.postMessage({ type: 'OVERDUE' })
		},
		onBlocked: () => self.postMessage({ type: 'ERROR' })
	})
	if (input.late) {
		const result = await client.open(input.url, input.name).then(
			() => {
				throw new Error('Expired broker open succeeded')
			},
			(error: unknown) => {
				if (!(error instanceof Error) || !('workerEffectOutcome' in error)) throw error
				return { outcome: error.workerEffectOutcome }
			}
		)
		self.postMessage({ type: 'EXPIRED' })
		const receipt = await client.close()
		return {
			outcome: result.outcome,
			discarded,
			overdue,
			matchingReceipt:
				receipt.scope === input.scope && receipt.requestId === client.host.identity.requestId,
			windowPresent: typeof window !== 'undefined'
		}
	}
	const before = await client.readGeneration(input.key)
	await client.writeGeneration(input.key, '5')
	const after = await client.readGeneration(input.key)
	const broker = await client.open(input.url, input.name)
	try {
		const receipt = await client.close()
		const echo = new Promise<unknown>((resolve) => {
			broker.port.onmessage = (event) => resolve(event.data)
		})
		broker.port.postMessage('SDK retains accepted port after host closure')
		return {
			before,
			after,
			echo: await echo,
			matchingReceipt:
				receipt.scope === input.scope && receipt.requestId === client.host.identity.requestId,
			windowPresent: typeof window !== 'undefined'
		}
	} finally {
		broker.port.close()
	}
}
self.onmessage = ({ data }: MessageEvent<Start | { type: 'TICK'; ms: number }>) => {
	if (data.type === 'TICK') clock.increment(data.ms)
	else
		void run(data).then(
			(result) => self.postMessage({ type: 'DONE', result }),
			() => self.postMessage({ type: 'ERROR' })
		)
}
