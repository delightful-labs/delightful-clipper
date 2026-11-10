import type { Db } from 'jazz-tools'
import type { ReadCapabilities } from '../../contracts/storage.js'

/** The browser session supplies its native upstream observation to the reader.
 * Server policy/query facades can use records without owning this resource. */
export function readConnection(
	db: Pick<Db, 'getSyncStatus' | 'onSyncStatusChange'>
): NonNullable<ReadCapabilities['observeConnection']> {
	return (next) => {
		const publish = () => next(db.getSyncStatus().link.state)
		const release = db.onSyncStatusChange(publish)
		try {
			publish()
		} catch (error) {
			release()
			throw error
		}
		return release
	}
}
