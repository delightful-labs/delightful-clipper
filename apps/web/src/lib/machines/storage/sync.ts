import { assign, fromPromise, setup } from 'xstate'
import type { SyncReceipt } from '../../contracts/storage.js'
export type SyncOutcome = { status: 'accepted' | 'rejected' | 'stopped' }
const actors = {
	accept: fromPromise(({ input }: { input: SyncReceipt[] }) =>
		Promise.all(input.map((receipt) => Promise.resolve().then(() => receipt.global())))
	)
}
export const storageSyncMachine = setup<
	{ receipts: SyncReceipt[]; result: SyncOutcome },
	{ type: 'SHUTDOWN' },
	typeof actors,
	{},
	{},
	{},
	never,
	string,
	SyncReceipt[],
	SyncOutcome
>({ actors }).createMachine({
	id: 'storage-sync',
	initial: 'pending',
	context: ({ input }) => ({ receipts: input, result: { status: 'stopped' } }),
	output: ({ context }) => context.result,
	on: { SHUTDOWN: '.stopped' },
	states: {
		pending: {
			invoke: {
				src: 'accept',
				input: ({ context }) => context.receipts,
				onDone: 'accepted',
				onError: 'rejected'
			}
		},
		accepted: { type: 'final', entry: assign({ receipts: [], result: { status: 'accepted' } }) },
		rejected: { type: 'final', entry: assign({ receipts: [], result: { status: 'rejected' } }) },
		stopped: { type: 'final', entry: assign({ receipts: [], result: { status: 'stopped' } }) }
	}
})
