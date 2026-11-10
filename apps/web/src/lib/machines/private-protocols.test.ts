import { expect, it, vi } from 'vitest'
import { createActor, eventSchema, waitFor } from 'xstate'
import { libraryMachine } from './capture/library.js'
import { readerExperienceMachine } from './reader/experience.js'
import {
	createShellRegistrationMachine,
	selectShellView,
	type ShellEvent
} from './offline/registration.js'

it('rejects library/reader self-coordination at the public schema boundary', async () => {
	const library = await eventSchema(libraryMachine)['~standard'].validate({
		type: 'CAPTURE_UPDATED'
	})
	const reader = await eventSchema(readerExperienceMachine)['~standard'].validate({
		type: 'REFRESH_SYNC'
	})
	expect(library.issues).toBeDefined()
	expect(reader.issues).toBeDefined()
	const rejection = vi.fn(),
		actor = createActor(libraryMachine, { input: undefined, onRejectedEvent: rejection }).start()
	Reflect.apply(actor.send, actor, [{ type: 'CAPTURE_UPDATED' }])
	expect(rejection).toHaveBeenCalledWith(expect.objectContaining({ reason: 'internalEvent' }))
	actor.send({ type: 'SHUTDOWN' })
	await waitFor(actor, (s) => s.status === 'done')
})
it('keeps shell coordination private while actual native registration reports arrive', async () => {
	let nativeReport: ((event: ShellEvent) => void) | undefined
	const rejected = vi.fn(),
		registration = { active: null, waiting: null, installing: null, ...new EventTarget() }
	const actor = createActor(
		createShellRegistrationMachine({
			register: async () => registration,
			observe: (_registration, report) => {
				nativeReport = report
				return () => {}
			}
		}),
		{ onRejectedEvent: rejected }
	).start()
	await vi.waitFor(() => expect(nativeReport).toBeDefined())
	for (const type of ['ATTEMPT_SETTLED', 'TIMED_OUT']) Reflect.apply(actor.send, actor, [{ type }])
	expect(rejected.mock.calls.map(([event]) => event.reason)).toEqual([
		'internalEvent',
		'internalEvent'
	])
	expect(selectShellView(actor.getSnapshot()).admitted).toBe(false)
	nativeReport?.({ type: 'STATUS', status: 'ready' })
	expect(selectShellView(actor.getSnapshot())).toMatchObject({ status: 'ready', admitted: true })
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().status).toBe('done')
})
// Type-only negative checks: native reports stay public, self-coordination does not.
function privateCommands(
	library: import('xstate').ActorRefFrom<typeof libraryMachine>,
	reader: import('xstate').ActorRefFrom<typeof readerExperienceMachine>
) {
	// @ts-expect-error Only the library itself may coordinate capture refresh.
	library.send({ type: 'CAPTURE_UPDATED' })
	// @ts-expect-error Only the reader itself may coordinate sync refresh.
	reader.send({ type: 'REFRESH_SYNC' })
}
void privateCommands
