import type { EventPayload } from '../events.js'
import { types, setup, createAsyncLogic } from 'xstate'

import type { SyncReceipt } from '../../contracts/storage.js'
export type SyncOutcome = { status: 'accepted' | 'rejected' | 'stopped' }
const actors = {
	accept: createAsyncLogic({
		run: ({ input }: { input: SyncReceipt[] }) =>
			Promise.all(input.map((receipt) => Promise.resolve().then(() => receipt.global())))
	})
}
export const storageSyncMachine = setup({
	schemas: {
		context: types<{ receipts: SyncReceipt[]; result: SyncOutcome }>(),
		events: { SHUTDOWN: types<EventPayload<{ type: 'SHUTDOWN' }, 'SHUTDOWN'>>() },
		input: types<SyncReceipt[]>(),
		output: types<SyncOutcome>(),
		tags: types<string>(),
		children: { accept: types<import('xstate').ActorRefFrom<(typeof actors)['accept']>>() }
	},
	actors
}).createMachine({
	id: 'storage-sync',
	initial: 'pending',
	context: ({ input }) => ({ receipts: input, result: { status: 'stopped' } }),
	output: ({ context }) => context.result,
	on: { SHUTDOWN: { target: '.stopped' } },
	states: {
		pending: {
			invoke: {
				id: 'accept',
				src: 'accept',
				input: ({ context }: { context: { receipts: SyncReceipt[]; result: SyncOutcome } }) =>
					context.receipts,
				onDone: { target: 'accepted' },
				onError: { target: 'rejected' }
			}
		},
		accepted: {
			type: 'final',
			entry: () => {
				return { context: { receipts: [], result: { status: 'accepted' } } }
			}
		},
		rejected: {
			type: 'final',
			entry: () => {
				return { context: { receipts: [], result: { status: 'rejected' } } }
			}
		},
		stopped: {
			type: 'final',
			entry: () => {
				return { context: { receipts: [], result: { status: 'stopped' } } }
			}
		}
	}
})
