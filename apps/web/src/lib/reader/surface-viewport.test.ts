import { expect, it } from 'vitest'
import { createActor, SimulatedClock, toPromise } from 'xstate'
import { surfaceViewportMachine } from './surface-viewport.js'

it.each(['open', 'detach'] as const)(
	'rejects a late %s reply before its timer is delivered',
	async (stage) => {
		const channel = new MessageChannel(),
			clock = new SimulatedClock(),
			attachmentId = crypto.randomUUID()
		let time = 0
		channel.port1.start()
		const actor = createActor(surfaceViewportMachine, {
			clock,
			input: {
				port: channel.port2,
				position: undefined,
				attachmentId,
				replyTimeoutMs: 5,
				now: () => time
			}
		}).start()
		const reply = async (type: 'VIEWPORT_OPENED' | 'VIEWPORT_SETTLED') => {
			const delivered = new Promise<void>((resolve) =>
				channel.port2.addEventListener('message', () => resolve(), { once: true })
			)
			channel.port1.postMessage({ type, attachmentId, outcome: 'closed' })
			await delivered
		}
		try {
			if (stage === 'detach') {
				await reply('VIEWPORT_OPENED')
				actor.send({ type: 'DETACH' })
			}
			time = 5
			await reply(stage === 'open' ? 'VIEWPORT_OPENED' : 'VIEWPORT_SETTLED')
			if (stage === 'open') {
				expect(actor.getSnapshot().matches({ remote: 'overdue' })).toBe(true)
				expect(actor.getSnapshot().status).toBe('active')
				await reply('VIEWPORT_SETTLED')
			}
			expect(await toPromise(actor)).toEqual({ outcome: 'overdue', position: undefined })
		} finally {
			actor.stop()
			channel.port1.close()
			channel.port2.close()
		}
	}
)
