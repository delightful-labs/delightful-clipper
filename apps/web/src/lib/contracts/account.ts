import type { LibraryCapability } from './library.js'
import type { SessionOwnerRef } from 'delightful-local-first/session/workflow'
import type {
	SessionScope,
	SessionReadinessBinding
} from 'delightful-local-first/session/contracts'
import type {
	RecoveryPhraseCapability,
	RecoveryScopeSource
} from 'delightful-local-first/recovery/contracts'
import type { RestorationCapability } from 'delightful-local-first/restoration/contracts'

export type RootWrite = Readonly<{
	local: () => Promise<void>
	global: () => Promise<void>
}>
export type RootAccess = Readonly<{
	read: () => Promise<'compatible' | 'missing' | 'incompatible'>
	ensure: () => RootWrite
}>
export type RecoveryBinding = Readonly<{
	source: RecoveryScopeSource
	capability: RecoveryPhraseCapability
}>
export type AccountObservation =
	| Readonly<{
			status: 'ready'
			localFirst?: boolean
			binding: object
			clientBinding?: object
			databaseBinding?: object
			prepare?: () => Promise<void>
			accountId: string
			signedIn?: boolean
			library?: LibraryCapability
			root: RootAccess
			recovery: RecoveryBinding
	  }>
	| Readonly<{ status: 'signed-out' | 'transitioning' | 'error' | 'closed' }>
export type ReadyAccountObservation = Extract<AccountObservation, { status: 'ready' }>
export type AccountBindingIdentity = Pick<
	ReadyAccountObservation,
	'status' | 'binding' | 'clientBinding' | 'databaseBinding' | 'accountId'
>
export function accountBindingIdentity(
	observation: ReadyAccountObservation
): AccountBindingIdentity {
	return {
		status: 'ready',
		binding: observation.binding,
		accountId: observation.accountId,
		...(observation.clientBinding === undefined
			? {}
			: { clientBinding: observation.clientBinding }),
		...(observation.databaseBinding === undefined
			? {}
			: { databaseBinding: observation.databaseBinding })
	}
}
export type AccountBinding = Readonly<{
	observation: ReadyAccountObservation
	release: () => void
}>
/** Native identity facts only; lifecycle/reuse decisions belong to readiness. */
export function sameAccountBinding(
	left: AccountObservation | AccountBindingIdentity,
	right: AccountObservation | AccountBindingIdentity
) {
	return (
		left.status === 'ready' &&
		right.status === 'ready' &&
		left.binding === right.binding &&
		left.accountId === right.accountId &&
		left.clientBinding === right.clientBinding &&
		left.databaseBinding === right.databaseBinding
	)
}
export type AccountHost = Readonly<{
	read: () => AccountObservation
	adopt?: (observation: ReadyAccountObservation) => AccountBinding
	prepare?: () => Promise<void>
	readiness: SessionReadinessBinding
	create: () => Promise<void>
	signOut?: () => Promise<void>
	logout: () => Promise<void>
	release: () => void
	restoration: Readonly<{ binding: object; capability: RestorationCapability }>
}>
export type AccountInput<Session extends object> = Readonly<{
	startup: { owner: SessionOwnerRef<Session>; scope: SessionScope }
	bind: (session: Session) => AccountHost
}>
