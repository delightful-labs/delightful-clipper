import { expect, it } from 'vitest'
import { createActor, SimulatedClock, toPromise } from 'xstate'
import { createAuthorizationMachine } from './authorization-machine.js'
import type { AccountAccess } from './authorization-machine.js'
const expected = '77777777-7777-4777-8777-777777777777'
async function authorize(value: AccountAccess) {
	const actor = createActor(
		createAuthorizationMachine((notify) => {
			notify(value)
			return () => {}
		}),
		{ input: { expected } }
	)
	const result = toPromise(actor)
	actor.start()
	return result
}
it('admits only the current account matching the confirmed connection', async () => {
	expect(await authorize({ kind: 'ready', accountId: expected })).toEqual({ status: 'connected' })
	expect(
		await authorize({ kind: 'ready', accountId: '88888888-8888-4888-8888-888888888888' })
	).toEqual({ status: 'signed-out' })
	expect(await authorize({ kind: 'signed-out' })).toEqual({ status: 'signed-out' })
	expect(await authorize({ kind: 'unavailable' })).toEqual({ status: 'unavailable' })
})
it('bounds account startup and releases its observation without granting admission', async () => {
	let released = false
	const clock = new SimulatedClock()
	const actor = createActor(
		createAuthorizationMachine(() => () => {
			released = true
		}),
		{ clock, input: { expected } }
	)
	const result = toPromise(actor)
	actor.start()
	clock.increment(15000)
	expect(await result).toEqual({ status: 'unavailable' })
	expect(released).toBe(true)
})
