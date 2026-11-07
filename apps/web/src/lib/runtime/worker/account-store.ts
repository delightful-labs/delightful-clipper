import { assign, createActor, fromCallback, fromPromise, sendTo, setup, toPromise } from 'xstate'
import type { AccountStore } from 'jazz-tools'

type StoragePort = { read: () => Promise<string | null>; write: (value: string) => Promise<void> }
type Input = { key: string; transform: (value: string | null) => string; storage: StoragePort }
type Context = Input & { current: string | null; replacement: string; ok: boolean }
type Event = { type: 'LOCKED' | 'LOCK_FAILED' | 'RELEASED' }
type LockCommand = { type: 'RELEASE' }

/** The worker holds the same Web Lock as Jazz's existing Window AccountStore.
 * Only the two unavoidable localStorage primitives cross the Window boundary. */
const lock = fromCallback<LockCommand, string>(({ input, sendBack, receive }) => {
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
	read: fromPromise(({ input }: { input: StoragePort }) => input.read()),
	transform: fromPromise(async ({ input }: { input: Context }) => input.transform(input.current)),
	write: fromPromise(({ input }: { input: Context }) => input.storage.write(input.replacement))
}
export const accountStoreUpdateMachine = setup<
	Context,
	Event,
	typeof actors,
	{},
	{},
	{},
	never,
	string,
	Input,
	boolean
>({ actors }).createMachine({
	id: 'worker-account-store-update',
	initial: 'acquiring',
	context: ({ input }) => ({ ...input, current: null, replacement: '', ok: false }),
	output: ({ context }) => context.ok,
	invoke: { id: 'lock', src: 'lock', input: ({ context }) => context.key },
	on: { LOCK_FAILED: '.failed' },
	states: {
		acquiring: { on: { LOCKED: 'reading' } },
		reading: {
			invoke: {
				src: 'read',
				input: ({ context }) => context.storage,
				onDone: {
					target: 'transforming',
					actions: assign({ current: ({ event }) => event.output })
				},
				onError: 'releasingFailure'
			}
		},
		transforming: {
			invoke: {
				src: 'transform',
				input: ({ context }) => context,
				onDone: {
					target: 'writing',
					actions: assign({ replacement: ({ event }) => event.output })
				},
				onError: 'releasingFailure'
			}
		},
		writing: {
			invoke: {
				src: 'write',
				input: ({ context }) => context,
				onDone: 'releasing',
				onError: 'releasingFailure'
			}
		},
		releasing: { entry: sendTo('lock', { type: 'RELEASE' }), on: { RELEASED: 'ready' } },
		releasingFailure: { entry: sendTo('lock', { type: 'RELEASE' }), on: { RELEASED: 'failed' } },
		ready: { type: 'final', entry: assign({ ok: true, current: null, replacement: '' }) },
		failed: { type: 'final', entry: assign({ current: null, replacement: '' }) }
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
