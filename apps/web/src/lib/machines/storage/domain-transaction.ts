import { createDomainTransaction as createSharedDomainTransaction } from 'delightful-local-first/transactions/workflow'
import type {
	DomainTransactionLifecycle,
	TransactionPreparedPort,
	TransactionDomainInput as SharedDomainInput,
	TransactionDomainChild,
	TransactionDomainSpawner
} from 'delightful-local-first/transactions/contracts'
import type { WriteHandle } from 'jazz-tools'
import type { TransactionResource } from '../../backend/jazz/transaction.js'
import type { SyncReceipt } from '../../contracts/storage.js'

export type PreparedPort = TransactionPreparedPort
export type TransactionDomainInput<Draft, Resource = TransactionResource> = SharedDomainInput<
	Draft,
	Resource
>
export type DomainChild = TransactionDomainChild<SyncReceipt>
export type DomainSpawner<Draft, Resource = TransactionResource> = TransactionDomainSpawner<
	Draft,
	Resource,
	SyncReceipt
>
export function required<Value>(value: Value | undefined): Value {
	if (value === undefined) throw new Error('Missing transaction domain resource')
	return value
}
/** Clipper supplies native resource/receipt defaults; DLF owns the generic bridge. */
export function createDomainTransaction<Draft, Resource = TransactionResource, Write = WriteHandle>(
	spawnDomain: DomainSpawner<Draft, Resource>,
	lifecycle: DomainTransactionLifecycle<Resource, Write>
) {
	return createSharedDomainTransaction<Draft, Resource, Write, SyncReceipt>(spawnDomain, lifecycle)
}
