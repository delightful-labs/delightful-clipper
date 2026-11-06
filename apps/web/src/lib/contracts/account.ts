import type { TokenIdentityCapability } from 'delightful-local-first/identity/token/contracts'
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
			binding: object
			accountId: string
			signedIn?: boolean
			library?: LibraryCapability
			root: RootAccess
			recovery: RecoveryBinding
	  }>
	| Readonly<{ status: 'signed-out' | 'transitioning' | 'error' | 'closed' }>
export type AccountHost = Readonly<{
	read: () => AccountObservation
	tokenIdentity?: Readonly<{
		binding: object
		capability: TokenIdentityCapability
		canSignInExisting: () => Promise<boolean>
	}>
	readiness: SessionReadinessBinding
	create: () => Promise<void>
	logout: () => Promise<void>
	release: () => void
	restoration: Readonly<{ binding: object; capability: RestorationCapability }>
}>
export type AccountInput<Session extends object> = Readonly<{
	startup: { owner: SessionOwnerRef<Session>; scope: SessionScope }
	bind: (session: Session) => AccountHost
}>
