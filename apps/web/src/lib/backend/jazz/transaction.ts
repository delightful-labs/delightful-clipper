import type { DetachedTransaction } from 'delightful-local-first/workspace/creation/contracts'
import type { Db, Transaction, WriteHandle } from 'jazz-tools'
import type { SyncReceipt } from '../../contracts/storage.js'
// This module lives in the application worker. An unexpectedly stopped owner
// transfers native custody here for the remainder of that realm's lifetime.
// Never replay it or infer that an issued commit can safely be rolled back.
const detached = new Set<DetachedTransaction<unknown, unknown>>()
export function retainDetachedTransaction<Resource, Write>(
	custody: DetachedTransaction<Resource, Write>
) {
	detached.add(custody)
}
export function hasDetachedTransactions() {
	return detached.size > 0
}

export type TransactionResource = {
	readonly tx: Transaction<'mergeable'>
	readonly commit: () => WriteHandle
	readonly global: () => Promise<void>
}
/** Scope is checked at transaction admission and the atomic commit boundary.
 * The owning actor drains an opened transaction; domain I/O leaves do not police its lifetime. */
export function transactionLifecycle(db: Pick<Db, 'beginTransaction'>, isCurrent: () => boolean) {
	const assertCurrent = () => {
		if (!isCurrent()) throw new Error('Library scope expired')
	}
	return {
		retainDetached: retainDetachedTransaction<TransactionResource, WriteHandle>,
		open: (): TransactionResource => {
			assertCurrent()
			const tx = db.beginTransaction()
			let committed: WriteHandle | undefined
			return {
				tx,
				commit: () => {
					const write = tx.commit()
					committed = write
					return write
				},
				global: () => {
					if (!committed) throw new Error('Missing committed receipt')
					return committed.wait({ tier: 'global' })
				}
			}
		},
		commit: (resource: TransactionResource) => {
			assertCurrent()
			return resource.commit()
		},
		persistLocal: (write: WriteHandle) => write.wait({ tier: 'local' }),
		rollback: (resource: TransactionResource) => resource.tx.rollback()
	}
}
export function transactionReceipt(resource: TransactionResource): SyncReceipt {
	return { global: resource.global }
}
