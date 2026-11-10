import type { EventPayload } from '../../machines/events.js'
import { types, createActor, createCallbackLogic, setup, toPromise, createAsyncLogic } from 'xstate'

import type { AccountStore } from 'jazz-tools'

type StoragePort = { read: () => Promise<string | null>; write: (value: string) => Promise<void> }
type Input = { key: string; transform: (value: string | null) => string; storage: StoragePort }
type Context = Input & { current: string | null; replacement: string; ok: boolean }
type Event = { type: 'LOCKED' | 'LOCK_FAILED' | 'RELEASED' }
type LockCommand = { type: 'RELEASE' }

/** The worker holds the same Web Lock as Jazz's existing Window AccountStore.
 * Only the two unavoidable localStorage primitives cross the Window boundary. */
const lock = createCallbackLogic<LockCommand, string>(({ input, sendBack, receive }) => {
	const controller = new AbortController()
	const released = Promise.withResolvers<void>()
	receive(() => released.resolve())
	void navigator.locks
		.request(input, { signal: controller.signal }, async () => {
			sendBack({ type: 'LOCKED' })
			await released.promise
		})
		.then(
			() => sendBack({ type: 'RELEASED' }),
			() => sendBack({ type: 'LOCK_FAILED' })
		)
	return () => {
		controller.abort()
		released.resolve()
	}
})
const actors = {
	lock,
	read: createAsyncLogic({ run: ({ input }: { input: StoragePort }) => input.read() }),
	transform: createAsyncLogic({
		run: async ({ input }: { input: Context }) => input.transform(input.current)
	}),
	write: createAsyncLogic({
		run: ({ input }: { input: Context }) => input.storage.write(input.replacement)
	})
}
export const accountStoreUpdateMachine = setup({
	schemas: {
		context: types<Context>(),
		events: {
			LOCKED: types<EventPayload<Event, 'LOCKED'>>(),
			LOCK_FAILED: types<EventPayload<Event, 'LOCK_FAILED'>>(),
			RELEASED: types<EventPayload<Event, 'RELEASED'>>()
		},
		input: types<Input>(),
		output: types<boolean>(),
		tags: types<string>(),
		children: {
			lock: types<import('xstate').ActorRefFrom<(typeof actors)['lock']>>(),
			read: types<import('xstate').ActorRefFrom<(typeof actors)['read']>>(),
			transform: types<import('xstate').ActorRefFrom<(typeof actors)['transform']>>(),
			write: types<import('xstate').ActorRefFrom<(typeof actors)['write']>>()
		}
	},
	actors
}).createMachine({
	id: 'worker-account-store-update',
	initial: 'acquiring',
	context: ({ input }) => ({ ...input, current: null, replacement: '', ok: false }),
	output: ({ context }) => context.ok,
	invoke: { id: 'lock', src: 'lock', input: ({ context }: { context: Context }) => context.key },
	on: { LOCK_FAILED: { target: '.failed' } },
	states: {
		acquiring: { on: { LOCKED: { target: 'reading' } } },
		reading: {
			invoke: {
				id: 'read',
				src: 'read',
				input: ({ context }: { context: Context }) => context.storage,
				onDone: (args) => {
					return { target: 'transforming', context: { current: args.event.output } }
				},
				onError: { target: 'releasingFailure' }
			}
		},
		transforming: {
			invoke: {
				id: 'transform',
				src: 'transform',
				input: ({ context }: { context: Context }) => context,
				onDone: (args) => {
					return { target: 'writing', context: { replacement: args.event.output } }
				},
				onError: { target: 'releasingFailure' }
			}
		},
		writing: {
			invoke: {
				id: 'write',
				src: 'write',
				input: ({ context }: { context: Context }) => context,
				onDone: { target: 'releasing' },
				onError: { target: 'releasingFailure' }
			}
		},
		releasing: {
			entry: (args, enq) => {
				enq.sendTo('lock', { type: 'RELEASE' })
			},
			on: { RELEASED: { target: 'ready' } }
		},
		releasingFailure: {
			entry: (args, enq) => {
				enq.sendTo('lock', { type: 'RELEASE' })
			},
			on: { RELEASED: { target: 'failed' } }
		},
		ready: {
			type: 'final',
			entry: () => {
				return { context: { ok: true, current: null, replacement: '' } }
			}
		},
		failed: {
			type: 'final',
			entry: () => {
				return { context: { current: null, replacement: '' } }
			}
		}
	}
})
export function createWorkerAccountStore(key: string, storage: StoragePort): AccountStore {
	return {
		read: storage.read,
		update: async (transform) => {
			const actor = createActor(accountStoreUpdateMachine, {
				input: { key, storage, transform }
			}).start()
			try {
				if (!(await toPromise(actor))) throw new Error('Account storage update failed')
			} finally {
				actor.stop()
			}
		}
	}
}
