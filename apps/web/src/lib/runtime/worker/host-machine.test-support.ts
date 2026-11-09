import { bindWorkerConnectivity } from '../../offline/connectivity.js'
import { createActor } from 'xstate'
import { vi } from 'vitest'
import { createSessionAcquisitionMachine } from 'delightful-local-first/session/workflow'
import type { Session } from '../../backend/jazz/account.js'
import type { AccountInput } from '../../contracts/account.js'
import { workerHostMachine } from './host-machine.js'

export function createWorkerHostFixture() {
	bindWorkerConnectivity(true)
	const unused = vi.fn(async () => {})
	const close = vi.fn(async () => {})
	const session: Session = {
		getSnapshot: () => ({ status: 'signed-out' }),
		subscribe: () => () => {},
		createLocalFirst: unused,
		restoreLocalFirst: unused,
		loginWithBackend: unused,
		linkWithBackend: unused,
		logout: unused,
		retry: unused,
		close
	}
	const binding = {}
	const owner = createActor(createSessionAcquisitionMachine<Session>(), {
		input: { binding, capability: { open: async () => session }, existing: session }
	}).start()
	const input: AccountInput<Session> = {
		startup: { owner, scope: { binding, attachment: {}, generation: 0 } },
		bind: () => ({
			read: () => ({ status: 'signed-out' }),
			readiness: {
				binding: {},
				capability: {
					readStatus: () => 'signed-out',
					subscribe: () => () => {},
					retry: unused
				}
			},
			create: unused,
			logout: unused,
			release: () => {},
			restoration: {
				binding: {},
				capability: {
					parsePhrase: async () => {
						throw new Error('Unused fixture restoration')
					},
					isCurrentBinding: () => false,
					restoreIdentity: unused,
					readIdentity: async () => ({ kind: 'unavailable' })
				}
			}
		})
	}
	return {
		close,
		owner,
		actor: createActor(workerHostMachine, { input: { ...input, scope: 'test-scope' } })
	}
}
