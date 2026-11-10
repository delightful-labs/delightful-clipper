import { createOrderedSignOutMachine } from 'delightful-local-first/session/sign-out/workflow'
import type {
	OrderedSignOutInput,
	SignOutStage
} from 'delightful-local-first/session/sign-out/contracts'
import type { AccountHost, AccountObservation } from '../../contracts/account.js'

export type { SignOutStage }
export const signOutMachine = createOrderedSignOutMachine()

/** Select immutable native capabilities before starting the shared owner. */
export function signOutInput(
	host: AccountHost,
	observation: AccountObservation,
	onOverdue?: (stage: SignOutStage) => void
): OrderedSignOutInput {
	const provider = host.signOut
	const observeSession = observation.status === 'ready' ? observation.logoutStatus : undefined
	return {
		...(provider ? { provider } : {}),
		...(observeSession ? { observeSession } : {}),
		session:
			observation.status === 'ready' && observation.logout ? observation.logout : host.logout,
		...(onOverdue ? { onOverdue } : {})
	}
}
