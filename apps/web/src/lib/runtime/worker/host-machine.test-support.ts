import { bindWorkerConnectivity } from '../../offline/connectivity.js'
import { createActor, type ActorOptions } from 'xstate'
import { vi } from 'vitest'
import { createSessionAcquisitionMachine } from 'delightful-local-first/session/workflow'
import type { Session } from '../../backend/jazz/account.js'
import type { WorkerHostClosed } from 'delightful-local-first/worker/channel/contracts'
import type { AccountInput, AccountHost } from '../../contracts/account.js'
import { workerHostMachine } from './host-machine.js'

export function createWorkerHostFixture(
	acquisition?: Promise<void>,
	closeAccountStore?: () => Promise<WorkerHostClosed>,
	closeBroker?: () => Promise<WorkerHostClosed>,
	options?: {
		account?: AccountHost
		clock?: ActorOptions<typeof workerHostMachine>['clock']
		closePolicy?: Partial<typeof import('./close-policy.js').REALM_CLOSE_POLICY>
	}
) {
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
		input: {
			binding,
			capability: {
				open: async () => {
					await acquisition
					return session
				}
			},
			...(acquisition ? {} : { existing: session })
		}
	}).start()
	const input: AccountInput<Session> = {
		startup: { owner, scope: { binding, attachment: {}, generation: 0 } },
		bind: () =>
			options?.account ?? {
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
			}
	}
	return {
		close,
		owner,
		actor: createActor(workerHostMachine, {
			...(options?.clock ? { clock: options.clock } : {}),
			input: {
				...input,
				scope: 'test-scope',
				...(options?.closePolicy ? { closePolicy: options.closePolicy } : {}),
				...(closeAccountStore ? { closeAccountStore } : {}),
				...(closeBroker ? { closeBroker } : {})
			}
		})
	}
}
