import type { Transaction } from 'jazz-tools'
import type { PreparedSave } from '../../contracts/storage.js'
import { app } from './schema.js'
/** Native immutable content insertion shared by normal publication and atomic sample setup. */
export function insertPreparedContent(tx: Pick<Transaction, 'insert'>, draft: PreparedSave) {
	const { id: assetId, ...asset } = draft.asset
	tx.insert(app.assets, asset, { id: assetId })
	const { id: snapshotId, ...snapshot } = draft.snapshot
	tx.insert(app.snapshots, snapshot, { id: snapshotId })
	const { id, ...document } = draft.document
	tx.insert(app.documents, document, { id })
}
