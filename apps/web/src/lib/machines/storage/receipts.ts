import type { StageResult, SyncReceipt } from '../../contracts/storage.js'

/** Collect local receipts only; this neither awaits nor claims remote acceptance. */
export function appendLocalReceipt(
	receipts: SyncReceipt[],
	settlement: StageResult['settlement']
): SyncReceipt[] {
	return settlement.kind === 'locallyPersisted' ? [...receipts, settlement.workspace] : receipts
}
