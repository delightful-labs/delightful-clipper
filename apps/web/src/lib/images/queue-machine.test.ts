import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { imageQueueMachine } from './queue-machine.js'
import type { ImageCapability } from '../contracts/images.js'
import type { ImageWrite, ArticleImage } from './schema.js'
import type { SyncReceipt } from '../contracts/storage.js'
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
	hasIntent = async () => false
) {
	let current = true
	const writes: ImageWrite[] = [],
		dispose = vi.fn()
	const stage = createWorkspaceCreationTransaction<ImageWrite, object, null, SyncReceipt, object>({
		open: () => ({}),
		readLocal: async () => null,
		assess: () => ({ outcome: 'eligible' }),
		stage: (_resource, attempt) => {
			writes.push(attempt.draft)
			return { global: async () => {} }
		},
		commit: () => ({}),
		persistLocal: local,
		rollback: () => true
	})
	const spawnWrite: ImageCapability['spawnReady'] = (spawn, draft) =>
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
	const actor = createActor(imageQueueMachine, { input: { capability: cap } }).start()
	return { actor, writes, request, dispose, expire: () => (current = false) }
}
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
	await vi.advanceTimersByTimeAsync(59999)
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
