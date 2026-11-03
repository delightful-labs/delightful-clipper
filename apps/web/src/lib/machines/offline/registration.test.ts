import { expect, it, vi } from 'vitest'
import { createActor, SimulatedClock, toPromise, waitFor } from 'xstate'
import { createShellRegistrationMachine } from './registration.js'
import type { ShellEvent, ShellRegistration } from './registration.js'
import { observeShell } from '../../offline/browser.js'
function registration(): ShellRegistration {
	return Object.assign(new EventTarget(), { active: null, waiting: null, installing: null })
}
it('keeps session admission closed until offline preparation settles, then retains it through updates', async () => {
	let report: ((event: ShellEvent) => void) | undefined
	const dispose = vi.fn()
	const actor = createActor(
		createShellRegistrationMachine({
			register: async () => registration(),
			observe: (_registration, send) => {
				report = send
				return dispose
			}
		})
	).start()
	await waitFor(actor, (s) => s.matches('watching'))
	expect(actor.getSnapshot().context.admitted).toBe(false)
	report?.({ type: 'STATUS', status: 'ready' })
	expect(actor.getSnapshot().context.admitted).toBe(true)
	report?.({ type: 'STATUS', status: 'preparing' })
	expect(actor.getSnapshot().context.admitted).toBe(true)
	report?.({ type: 'STATUS', status: 'waiting' })
	expect(actor.getSnapshot().context.status).toBe('waiting')
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
	expect(dispose).toHaveBeenCalledOnce()
	expect(actor.getSnapshot().context.registration).toBeUndefined()
})
it('offers the normal DLF session path after unsupported or failed registration', async () => {
	for (const register of [
		async () => undefined,
		async () => {
			throw new Error('Unavailable')
		}
	]) {
		const actor = createActor(
			createShellRegistrationMachine({ register, observe: () => () => {} })
		).start()
		await waitFor(actor, (s) => s.context.admitted)
		expect(['unsupported', 'failed']).toContain(actor.getSnapshot().context.status)
		actor.send({ type: 'SHUTDOWN' })
	}
})
it('detects a redundant first installer even when its registration slot was cleared', () => {
	const worker = Object.assign(new EventTarget(), { state: 'installing' }),
		reg = registration(),
		statuses: ShellEvent[] = []
	reg.installing = worker
	const dispose = observeShell(reg, (event) => statuses.push(event))
	worker.state = 'redundant'
	reg.installing = null
	worker.dispatchEvent(new Event('statechange'))
	expect(statuses.at(-1)).toEqual({ type: 'STATUS', status: 'failed' })
	dispose()
	worker.state = 'activated'
	worker.dispatchEvent(new Event('statechange'))
	expect(statuses.at(-1)).toEqual({ type: 'STATUS', status: 'failed' })
})

it('does not block DLF acquisition forever when first installation stalls', async () => {
	const clock = new SimulatedClock(),
		dispose = vi.fn()
	const actor = createActor(
		createShellRegistrationMachine({
			register: async () => registration(),
			observe: () => dispose
		}),
		{ clock }
	).start()
	await waitFor(actor, (s) => s.matches('watching'))
	clock.increment(45000)
	expect(actor.getSnapshot().context).toMatchObject({
		status: 'failed',
		admitted: true,
		registration: undefined
	})
	expect(dispose).toHaveBeenCalledOnce()
	actor.send({ type: 'SHUTDOWN' })
})
