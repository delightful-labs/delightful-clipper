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
			root: RootAccess
			recovery: RecoveryBinding
	  }>
	| Readonly<{ status: 'signed-out' | 'transitioning' | 'error' | 'closed' }>
export type AccountHost = Readonly<{
	read: () => AccountObservation
	subscribe: (notify: (observation: AccountObservation) => void) => () => void
	create: () => Promise<void>
	logout: () => Promise<void>
	retry: () => Promise<void>
	close: () => Promise<void>
	restoration: Readonly<{ binding: object; capability: RestorationCapability }>
}>
export type AccountInput = Readonly<{ open: () => Promise<AccountHost> }>
