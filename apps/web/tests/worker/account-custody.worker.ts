/// <reference lib="webworker" />
import { z } from 'zod'
import { SimulatedClock } from 'xstate'
import { createScopedAccountStorage } from '../../src/lib/runtime/worker/scoped-storage-channel.js'
import { createScopedWorkerAccountStore } from '../../src/lib/runtime/worker/scoped-account-store.js'
import { hostEnvelopeSchema } from '../../src/lib/runtime/worker/host-close-channel.js'

const initialize = z.object({
	type: z.literal('INIT'),
	data: z.instanceof(MessagePort),
	control: z.instanceof(MessagePort),
	scope: z.uuid(),
	key: z.string(),
	forced: z.boolean()
})
const command = z.object({ type: z.enum(['INTERRUPT', 'OVERDUE', 'FINISH']) })
const failure = z.object({
	operationId: z.uuid(),
	scope: z.uuid(),
	writeOutcome: z.literal('unknown')
})
const clock = new SimulatedClock()
let storage: ReturnType<typeof createScopedAccountStorage> | undefined
let store: ReturnType<typeof createScopedWorkerAccountStore> | undefined
let boundKey = ''
let forced = false,
	firstTransforms = 0,
	secondTransforms = 0,
	closedSeen = false
let second: Promise<void> = Promise.resolve()
function reportOverdue() {
	self.postMessage({ type: 'OVERDUE', firstTransforms, secondTransforms })
}
self.onmessage = ({ data }: MessageEvent<unknown>) => {
	const init = initialize.safeParse(data)
	if (init.success) {
		forced = init.data.forced
		boundKey = init.data.key
		init.data.control.addEventListener('message', (event: MessageEvent<unknown>) => {
			const parsed = hostEnvelopeSchema.safeParse(event.data)
			if (!parsed.success) return
			void Promise.resolve()
				.then(() => Promise.resolve())
				.then(() =>
					self.postMessage({
						type: 'CONTROL_PROCESSED',
						scope: parsed.data.scope,
						requestId: parsed.data.requestId,
						closedSeen
					})
				)
		})
		storage = createScopedAccountStorage(init.data.data, init.data.control, init.data.scope, {
			clock,
			requestTimeoutMs: 5,
			closeTimeoutMs: 10,
			onOverdue: reportOverdue,
			onBlocked: () => self.postMessage({ type: 'UNEXPECTED_FAILURE' })
		})
		void storage.host.closed.then(() => {
			closedSeen = true
		})
		store = createScopedWorkerAccountStore(init.data.key, storage, {
			clock,
			deadlineMs: 20,
			onOverdue: reportOverdue
		})
		void store
			.update((current) => {
				if (current !== null) throw new Error('Unexpected fixture selection')
				firstTransforms++
				return 'persisted'
			})
			.then(
				() => self.postMessage({ type: 'UNEXPECTED_SUCCESS' }),
				(error: unknown) => {
					const facts = failure.parse(error)
					self.postMessage({
						type: 'WRITE_UNKNOWN',
						...facts,
						windowPresent: typeof window !== 'undefined'
					})
					if (!forced && store)
						second = store
							.update(() => {
								secondTransforms++
								return 'must-not-write'
							})
							.then(
								() => {
									throw new Error('Closed scope accepted a second update')
								},
								() => {}
							)
				}
			)
		return
	}
	const parsed = command.safeParse(data)
	if (!parsed.success || !store || !storage) return
	if (parsed.data.type === 'INTERRUPT') {
		if (forced) store.dispose()
		else clock.increment(5)
	} else if (parsed.data.type === 'OVERDUE') clock.increment(10)
	else {
		const current = store,
			transport = storage
		void second
			.then(async () => {
				if (forced) {
					await transport.host.closed
					const locks = await navigator.locks.query()
					self.postMessage({
						type: 'FINISHED',
						cleanOwnerClose: false,
						firstTransforms,
						secondTransforms,
						held: locks.held?.filter((lock) => lock.name === boundKey).length
					})
				} else {
					const receipt = await current.close()
					self.postMessage({
						type: 'FINISHED',
						cleanOwnerClose: true,
						firstTransforms,
						secondTransforms,
						receipt
					})
				}
			})
			.catch(() => self.postMessage({ type: 'UNEXPECTED_FAILURE' }))
	}
}
