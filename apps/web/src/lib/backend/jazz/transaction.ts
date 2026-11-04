import type { Db, Transaction, WriteHandle } from 'jazz-tools'
import type { SyncReceipt } from '../../contracts/storage.js'
import type { Article } from '../../contracts/articles.js'
export type TransactionResource = {
	tx: Transaction<'mergeable'>
	write?: WriteHandle
	article?: Article | null
}
/** Scope is checked at transaction admission and the atomic commit boundary.
 * The owning actor drains an opened transaction; domain I/O leaves do not police its lifetime. */
export function transactionLifecycle(db: Pick<Db, 'beginTransaction'>, isCurrent: () => boolean) {
	const assertCurrent = () => {
		if (!isCurrent()) throw new Error('Library scope expired')
	}
	return {
		open: (): TransactionResource => {
			assertCurrent()
			return { tx: db.beginTransaction() }
		},
		commit: (resource: TransactionResource) => {
			assertCurrent()
			const write = resource.tx.commit()
			resource.write = write
			return write
		},
		persistLocal: (write: WriteHandle) => write.wait({ tier: 'local' }),
		rollback: (resource: TransactionResource) => resource.tx.rollback()
	}
}
export function transactionReceipt(resource: TransactionResource): SyncReceipt {
	return {
		global: () => {
			if (!resource.write) throw new Error('Missing committed receipt')
			return resource.write.wait({ tier: 'global' })
		}
	}
}
