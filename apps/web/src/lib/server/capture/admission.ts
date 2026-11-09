import { createActor } from 'xstate'
import { captureAdmissionMachine } from '../../machines/capture/admission.js'
import { CaptureError } from './errors.js'
// Instance-local abuse bound, not a distributed quota or persistent account store.
const actor = createActor(captureAdmissionMachine).start()
export function acquireCapture(owner: string) {
	let lease: number | undefined
	actor.send({
		type: 'ACQUIRE' as const,
		owner,
		now: Date.now(),
		reply: (value) => {
			lease = value
		}
	})
	if (lease === undefined) throw new CaptureError('rateLimited', 429, true)
	const granted = lease
	return () => actor.send({ type: 'RELEASE' as const, lease: granted })
}
