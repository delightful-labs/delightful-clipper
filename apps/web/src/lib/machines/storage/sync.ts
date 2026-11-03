import { fromPromise, setup } from 'xstate'
import type { SyncReceipt } from '../../contracts/storage.js'
export const storageSyncMachine = setup({
	actors: {
		accept: fromPromise(({ input }: { input: SyncReceipt[] }) =>
			Promise.all(input.map((receipt) => receipt.global()))
		)
	}
}).createMachine({
	id: 'storage-sync',
	initial: 'pending',
	context: ({ input }: { input: SyncReceipt[] }) => ({ receipts: input }),
	states: {
		pending: {
			invoke: {
				src: 'accept',
				input: ({ context }) => context.receipts,
				onDone: 'accepted',
				onError: 'rejected'
			}
		},
		accepted: { type: 'final' },
		rejected: { type: 'final' }
	}
})
