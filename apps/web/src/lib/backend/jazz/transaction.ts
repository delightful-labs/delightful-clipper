import type { Db, Transaction, WriteHandle } from 'jazz-tools'
import type { SyncReceipt } from '../../contracts/storage.js'
import type { Article } from '../../contracts/articles.js'
export type TransactionResource = {
	tx: Transaction<'mergeable'>
	write?: WriteHandle
	article?: Article | null
}
/** Native transaction mechanics only; eligibility and mutations remain with each domain operation. */
export function transactionLifecycle(db: Pick<Db, 'beginTransaction'>, check: () => void) {
	return {
		open: (): TransactionResource => {
			check()
			return { tx: db.beginTransaction() }
		},
		commit: (resource: TransactionResource) => {
			check()
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
