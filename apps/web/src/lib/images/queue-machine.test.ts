import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor, SimulatedClock } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { imageQueueMachine } from './queue-machine.js'
import type { ImageCapability, ImageSpawner } from '../contracts/images.js'
import type { ImageWrite, ArticleImage } from './schema.js'
import type { SyncReceipt } from '../contracts/storage.js'
import type { WorkspaceCreationAttempt } from 'delightful-local-first/workspace/creation/contracts'
const image: ArticleImage = {
	id: crypto.randomUUID(),
	libraryId: crypto.randomUUID(),
	documentId: crypto.randomUUID(),
	sourceUrl: 'https://example.com/image.png',
	status: 'pending',
	assetId: null,
	retryable: true
}
class TestWorker {
	static workers: TestWorker[] = []
	onmessage: ((event: { data: unknown }) => void) | null = null
	onerror: (() => void) | null = null
	onmessageerror: (() => void) | null = null
	terminate = vi.fn()
	postMessage = vi.fn()
	constructor() {
		TestWorker.workers.push(this)
	}
}
beforeEach(() => {
	TestWorker.workers = []
	vi.stubGlobal('Worker', TestWorker)
	vi.stubGlobal('window', new EventTarget())
	vi.stubGlobal('navigator', { onLine: true })
})
afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllGlobals()
})
function fixture(
	request: ImageCapability['request'] = vi.fn(async () => ({
		bytes: new Uint8Array([1]),
		mediaType: 'image/png'
	})),
	local = async () => {},
	hasIntent = async () => false,
	options: { clock?: SimulatedClock; now?: () => number } = {}
) {
	let current = true
	const writes: ImageWrite[] = [],
		dispose = vi.fn()
	const received: WorkspaceCreationAttempt<ImageWrite>[] = []
	const stage = createWorkspaceCreationTransaction<ImageWrite, object, null, SyncReceipt, object>({
		retainDetached: vi.fn(),
		open: () => ({}),
		readLocal: async (_resource, attempt) => {
			received.push(attempt)
			return null
		},
		assess: () => ({ outcome: 'eligible' }),
		stage: (_resource, attempt) => {
			writes.push(attempt.draft)
			return { global: async () => {} }
		},
		commit: () => ({}),
		persistLocal: local,
		rollback: () => true
	})
	const spawnWrite = (spawn: ImageSpawner, draft: ImageWrite) =>
		spawn(stage, {
			input: {
				attempt: {
					operationId: draft.image.id,
					workspaceId: draft.image.id,
					membershipId: draft.image.id,
					draft
				}
			}
		})
	const cap: ImageCapability = {
		isCurrent: () => current,
		hasIntent,
		subscribe: (next) => {
			next([image])
			return dispose
		},
		subscribeImage: () => () => {},
		asset: async () => null,
		request,
		spawnReady: spawnWrite,
		spawnFailure: spawnWrite
	}
	const actor = createActor(imageQueueMachine, {
		input: {
			capability: cap,
			now: options.now ?? (() => options.clock?.now() ?? performance.now())
		},
		...(options.clock ? { clock: options.clock } : {})
	}).start()
	return { actor, writes, received, request, dispose, expire: () => (current = false) }
}
it.each(['ready', 'failed'] as const)(
	'preserves selected image identity and %s payload in the actual native child',
	async (kind) => {
		const { actor, received } = fixture(
			kind === 'failed'
				? vi.fn(async () => {
						throw new Error('unsupportedMedia')
					})
				: undefined
		)
		const result = { bytes: new Uint8Array([1]), mediaType: 'image/png', width: 1, height: 1 }
		if (kind === 'ready') {
			await waitFor(actor, (snapshot) =>
				snapshot.matches({ running: { queue: { processing: 'waiting' } } })
			)
			TestWorker.workers[0]!.onmessage?.({ data: { kind: 'ready', result } })
		}
		await waitFor(actor, (snapshot) => snapshot.context.rows[0]?.status === kind)
		expect(received).toHaveLength(1)
		expect(received[0]).toMatchObject({
			operationId: image.id,
			workspaceId: image.id,
			membershipId: image.id,
			draft: { kind }
		})
		expect(received[0]!.draft.image).toBe(image)
		if (received[0]!.draft.kind === 'ready') expect(received[0]!.draft.result).toEqual(result)
		actor.send({ type: 'SHUTDOWN' })
		await toPromise(actor)
	}
)
it('owns worker creation/posting, continues independently of reader detachment, and drains an issued write', async () => {
	const gate = Promise.withResolvers<void>(),
		{ actor, writes, dispose } = fixture(undefined, () => gate.promise)
	await waitFor(actor, (s) => s.matches({ running: { queue: { processing: 'waiting' } } }))
	const worker = TestWorker.workers[0]!
	expect(worker.postMessage).toHaveBeenCalledOnce()
	actor.send({ type: 'DETACH' })
	worker.onmessage?.({
		data: {
			kind: 'ready',
			result: { bytes: new Uint8Array([1]), mediaType: 'image/png', width: 1, height: 1 }
		}
	})
	await waitFor(actor, (s) => s.matches({ running: { queue: 'savingReady' } }))
	expect(worker.terminate).toHaveBeenCalledOnce()
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().status).toBe('active')
	gate.resolve()
	await toPromise(actor)
	expect(writes).toHaveLength(1)
	expect(dispose).toHaveBeenCalledOnce()
})
it('bounds retry attempts/backoff and preserves a manual retry after a permanent processing failure', async () => {
	vi.useFakeTimers()
	const request = vi.fn(async () => {
			throw new Error('sourceUnavailable')
		}),
		{ actor, writes } = fixture(request)
	await vi.advanceTimersByTimeAsync(60000)
	expect(request).toHaveBeenCalledTimes(5)
	expect(writes).toHaveLength(5)
	actor.send({ type: 'WAKE' })
	await vi.advanceTimersByTimeAsync(60000)
	expect(request).toHaveBeenCalledTimes(5)
	actor.send({ type: 'RETRY', id: image.id })
	await vi.advanceTimersByTimeAsync(0)
	expect(request).toHaveBeenCalledTimes(6)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('blocks unknown native writes without automatic replay or explicit blind retry', async () => {
	const request = vi.fn(async () => {
			throw new Error('unsupportedMedia')
		}),
		{ actor, writes } = fixture(request, async () => {
			throw new Error('Unknown settlement')
		})
	await waitFor(actor, (s) => s.context.blocked.includes(image.id))
	actor.send({ type: 'WAKE' })
	actor.send({ type: 'RETRY', id: image.id })
	expect(writes).toHaveLength(1)
	expect(request).toHaveBeenCalledOnce()
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('cancels acquisition when offline or shutting down and discards expired processing results', async () => {
	const first = fixture(
		vi.fn(
			(_url?: string, _id?: string, signal?: AbortSignal) =>
				new Promise<{ bytes: Uint8Array; mediaType: string }>((_resolve, reject) =>
					signal?.addEventListener('abort', () => reject(new Error('canceled')))
				)
		)
	)
	await waitFor(first.actor, (s) => s.matches({ running: { queue: 'fetching' } }))
	first.actor.send({ type: 'CONNECTIVITY', online: false })
	await waitFor(first.actor, (s) => s.matches({ running: { queue: 'idle' } }))
	expect(first.writes).toEqual([])
	first.actor.send({ type: 'SHUTDOWN' })
	await toPromise(first.actor)
	const second = fixture()
	await waitFor(second.actor, (s) => s.matches({ running: { queue: { processing: 'waiting' } } }))
	second.expire()
	TestWorker.workers.at(-1)?.onmessage?.({
		data: {
			kind: 'ready',
			result: { bytes: new Uint8Array([1]), mediaType: 'image/png', width: 1, height: 1 }
		}
	})
	expect(second.writes).toEqual([])
	second.actor.send({ type: 'SHUTDOWN' })
	await toPromise(second.actor)
})
it('drains an issued write even when image observation fails', async () => {
	const gate = Promise.withResolvers<void>(),
		{ actor } = fixture(
			vi.fn(async () => {
				throw new Error('unsupportedMedia')
			}),
			() => gate.promise
		)
	await waitFor(actor, (s) => s.matches({ running: { queue: 'savingFailure' } }))
	actor.send({ type: 'OBSERVATION_FAILED' })
	actor.send({ type: 'SHUTDOWN' })
	expect(actor.getSnapshot().status).toBe('active')
	gate.resolve()
	await toPromise(actor)
})

it('honors the gateway Retry-After delay instead of exhausting retries inside its rate limit', async () => {
	vi.useFakeTimers()
	const { ImageFetchError } = await import('./failure.js')
	const request = vi.fn(async () => {
			throw new ImageFetchError('rateLimited', 60000)
		}),
		{ actor } = fixture(request)
	await vi.advanceTimersByTimeAsync(30000)
	actor.send({ type: 'WAKE' })
	await vi.advanceTimersByTimeAsync(29999)
	expect(request).toHaveBeenCalledOnce()
	await vi.advanceTimersByTimeAsync(1)
	expect(request).toHaveBeenCalledTimes(2)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
it('releases a worker if posting its input fails after acquisition', async () => {
	vi.stubGlobal(
		'Worker',
		class extends TestWorker {
			override postMessage = vi.fn(() => {
				throw new Error('Clone unavailable')
			})
		}
	)
	const { actor, writes } = fixture()
	await waitFor(
		actor,
		(s) => s.matches({ running: { queue: 'idle' } }) && s.context.attempts[image.id] === 1
	)
	expect(TestWorker.workers[0]?.terminate).toHaveBeenCalledOnce()
	expect(writes).toHaveLength(1)
	expect(writes[0]).toMatchObject({ kind: 'failed', retryable: false })
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})

it.each(['worker', 'message', 'reply'] as const)(
	'settles native %s processing failure before writing image failure',
	async (failure) => {
		const f = fixture()
		await waitFor(f.actor, (s) => s.matches({ running: { queue: { processing: 'waiting' } } }))
		const worker = TestWorker.workers[0]!
		if (failure === 'worker') worker.onerror?.()
		if (failure === 'message') worker.onmessageerror?.()
		if (failure === 'reply') worker.onmessage?.({ data: { kind: 'ready', result: {} } })
		await waitFor(f.actor, (s) => s.context.rows[0]?.status === 'failed')
		expect(worker.terminate).toHaveBeenCalledOnce()
		expect(f.writes).toEqual([{ image, kind: 'failed', retryable: false }])
		f.actor.send({ type: 'SHUTDOWN' })
		await toPromise(f.actor)
	}
)

it.each(['timer', 'late-result'] as const)(
	'retains the 20-second processing limit with %s and cleanup before failure writes',
	async (mode) => {
		const clock = new SimulatedClock()
		let time = 0
		const f = fixture(undefined, undefined, undefined, { clock, now: () => time })
		await waitFor(f.actor, (s) => s.matches({ running: { queue: { processing: 'waiting' } } }))
		const worker = TestWorker.workers[0]!
		if (mode === 'timer') clock.increment(20000)
		else {
			time = 20000
			worker.onmessage?.({
				data: {
					kind: 'ready',
					result: { bytes: new Uint8Array([1]), mediaType: 'image/png', width: 1, height: 1 }
				}
			})
		}
		await waitFor(f.actor, (s) => s.context.rows[0]?.status === 'failed')
		expect(worker.terminate).toHaveBeenCalledOnce()
		expect(f.writes).toEqual([{ image, kind: 'failed', retryable: false }])
		f.actor.send({ type: 'SHUTDOWN' })
		await toPromise(f.actor)
	}
)

it('does not acknowledge image shutdown or write through failed native cleanup', async () => {
	const f = fixture()
	await waitFor(f.actor, (s) => s.matches({ running: { queue: { processing: 'waiting' } } }))
	const worker = TestWorker.workers[0]!
	worker.terminate.mockImplementation(() => {
		throw new Error('Cleanup unavailable')
	})
	worker.onmessage?.({ data: { kind: 'failed' } })
	f.actor.send({ type: 'SHUTDOWN' })
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.writes).toEqual([])
	f.actor.stop()
	expect(worker.terminate).toHaveBeenCalledOnce()
})
it.each(['SHUTDOWN', 'OBSERVATION_FAILED'] as const)(
	'releases a waiting image job on %s and refuses late replies without writing',
	async (type) => {
		const f = fixture()
		await waitFor(f.actor, (s) => s.matches({ running: { queue: { processing: 'waiting' } } }))
		const worker = TestWorker.workers[0]!,
			late = worker.onmessage
		f.actor.send({ type })
		if (type === 'SHUTDOWN') await toPromise(f.actor)
		else await waitFor(f.actor, (s) => s.matches({ running: { queue: 'unavailable' } }))
		late?.({ data: { kind: 'failed' } })
		expect(worker.terminate).toHaveBeenCalledOnce()
		expect(worker.onmessage).toBeNull()
		expect(worker.onerror).toBeNull()
		expect(worker.onmessageerror).toBeNull()
		expect(f.writes).toEqual([])
		if (type !== 'SHUTDOWN') {
			f.actor.send({ type: 'SHUTDOWN' })
			await toPromise(f.actor)
		}
	}
)
it('preserves image failure mapping when native worker construction fails', async () => {
	vi.stubGlobal(
		'Worker',
		class {
			constructor() {
				throw new Error('Worker unavailable')
			}
		}
	)
	const f = fixture()
	await waitFor(f.actor, (s) => s.context.rows[0]?.status === 'failed')
	expect(f.writes).toEqual([{ image, kind: 'failed', retryable: false }])
	expect(TestWorker.workers).toEqual([])
	f.actor.send({ type: 'SHUTDOWN' })
	await toPromise(f.actor)
})
it('resumes an interrupted pending image automatically when connectivity returns', async () => {
	const request = vi.fn<ImageCapability['request']>(async () => ({
		bytes: new Uint8Array([1]),
		mediaType: 'image/png'
	}))
	request.mockImplementationOnce(
		(_url, _id, signal) =>
			new Promise((_resolve, reject) =>
				signal.addEventListener('abort', () => reject(new Error('canceled')))
			)
	)
	const { actor, writes } = fixture(request)
	await waitFor(actor, (s) => s.matches({ running: { queue: 'fetching' } }))
	actor.send({ type: 'CONNECTIVITY', online: false })
	await waitFor(actor, (s) => s.matches({ running: { queue: 'idle' } }))
	actor.send({ type: 'CONNECTIVITY', online: true })
	await waitFor(actor, (s) => s.matches({ running: { queue: { processing: 'waiting' } } }))
	TestWorker.workers.at(-1)?.onmessage?.({
		data: {
			kind: 'ready',
			result: { bytes: new Uint8Array([1]), mediaType: 'image/png', width: 1, height: 1 }
		}
	})
	await waitFor(actor, (s) => s.context.blocked.includes(image.id))
	expect(request).toHaveBeenCalledTimes(2)
	expect(writes).toHaveLength(1)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})

it('checks persisted image operation identity before acquisition and does not replay an existing publication', async () => {
	const { actor, request, writes } = fixture(
		undefined,
		async () => {},
		async () => true
	)
	await waitFor(actor, (s) => s.context.blocked.includes(image.id))
	expect(request).not.toHaveBeenCalled()
	expect(writes).toEqual([])
	actor.send({ type: 'RETRY', id: image.id })
	actor.send({ type: 'WAKE' })
	expect(request).not.toHaveBeenCalled()
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})

it('pauses all pending images during the server quota window', async () => {
	vi.useFakeTimers()
	const { ImageFetchError } = await import('./failure.js')
	const request = vi.fn<ImageCapability['request']>(async () => ({
		bytes: new Uint8Array([1]),
		mediaType: 'image/png'
	}))
	request.mockRejectedValueOnce(new ImageFetchError('rateLimited', 60000))
	const { actor } = fixture(request),
		other = { ...image, id: crypto.randomUUID(), sourceUrl: 'https://example.com/second.png' }
	actor.send({ type: 'IMAGE_ROWS', rows: [image, other] })
	await vi.advanceTimersByTimeAsync(59999)
	expect(request).toHaveBeenCalledOnce()
	await vi.advanceTimersByTimeAsync(1)
	expect(request).toHaveBeenCalledTimes(2)
	expect(request.mock.calls[1]?.[0]).toBe(other.sourceUrl)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
