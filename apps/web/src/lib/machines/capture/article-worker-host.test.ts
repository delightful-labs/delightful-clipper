import { it, expect, vi } from 'vitest'
import { createActor, waitFor, toPromise } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import type { ArticleSaveResult } from '../../contracts/articles.js'
import type {
	QueueReport,
	RpcReply,
	WorkerOutput,
	WorkerInput
} from '../../contracts/article-worker.js'
import type { SyncReceipt } from '../../contracts/storage.js'
import type { FailureDraft } from './article-worker-call.js'
import { createArticleWorkerHostMachine } from './article-worker-host.js'
import type { HostResourceEvent, HostCapability } from './article-worker-host.js'
import { controlledSave } from './library.test-support.js'
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing fixture resource')
	return value
}
function fixture(
	options: {
		save?: () => Promise<ArticleSaveResult>
		network?: (signal: AbortSignal) => Promise<RpcReply>
		lookup?: () => Promise<RpcReply>
		persistFailure?: () => Promise<void>
		failOpen?: boolean
	} = {}
) {
	let resourceReport: ((event: HostResourceEvent) => void) | undefined
	let current = true
	const posts: WorkerInput[] = []
	const order: string[] = []
	const saved = vi.fn(
		options.save ??
			(async (): Promise<ArticleSaveResult> => ({
				kind: 'saved',
				operationId: 'saved',
				ready: true,
				receipts: []
			}))
	)
	const saveShutdown = vi.fn()
	const save = controlledSave(saved, saveShutdown)
	const persistFailure = vi.fn(options.persistFailure ?? (async () => {}))
	const failure = createWorkspaceCreationTransaction<
		FailureDraft,
		object,
		boolean,
		SyncReceipt,
		object
	>({
		retainDetached: vi.fn(),
		open: () => ({}),
		readLocal: async () => true,
		assess: () => ({ outcome: 'eligible' }),
		stage: () => ({ global: async () => {} }),
		commit: () => ({}),
		persistLocal: persistFailure,
		rollback: () => true
	})
	const network = vi.fn<HostCapability['network']>(async (_call: unknown, signal: AbortSignal) =>
		options.network
			? options.network(signal)
			: { method: 'resolve', status: 200, bytes: new Uint8Array([1]) }
	)
	const lookup = vi.fn<HostCapability['lookup']>(
		options.lookup ?? (async () => ({ method: 'document', exists: false }))
	)
	const report = vi.fn((event: QueueReport) => {
		order.push(event.type)
	})
	const dispose = vi.fn(() => order.push('dispose'))
	const quiesce = vi.fn(() => order.push('quiesce'))
	const observe = vi.fn(() => required(resourceReport)({ type: 'PENDING_ROWS', rows: [] }))
	const machine = createArticleWorkerHostMachine({
		libraryId: 'library',
		debug: false,
		online: () => true,
		isCurrent: () => current,
		save: (spawn, input) => spawn(save, { input }),
		failure: (spawn, input) => spawn(failure, { input }),
		network,
		lookup,
		open: (next) => {
			if (options.failOpen) throw new Error('Worker unavailable')
			resourceReport = next
			return { post: (message) => posts.push(message), observe, quiesce, dispose }
		}
	})
	const actor = createActor(machine, { input: { report } }).start()
	return {
		actor,
		report,
		posts,
		saved,
		saveShutdown,
		persistFailure,
		network,
		lookup,
		dispose,
		quiesce,
		observe,
		order,
		emit: (event: HostResourceEvent) => required(resourceReport)(event),
		message: (message: WorkerOutput) =>
			required(resourceReport)({ type: 'WORKER_MESSAGE', message }),
		expire: () => {
			current = false
		}
	}
}
const saveCall: WorkerOutput = {
	type: 'CALL',
	id: 'save',
	method: 'save',
	request: { url: 'https://example.com/' }
}
const networkCall: WorkerOutput = {
	type: 'CALL',
	id: 'fetch',
	method: 'resolve',
	url: 'https://example.com/',
	requestId: 'request'
}
it('initializes before observing, wakes only on reconnection and disposes before reporting closed', async () => {
	const f = fixture()
	expect(f.posts[0]).toEqual({ type: 'INIT', libraryId: 'library', debug: false })
	expect(f.observe).toHaveBeenCalledOnce()
	f.emit({ type: 'CONNECTIVITY', online: true })
	expect(f.posts).toEqual([
		{ type: 'INIT', libraryId: 'library', debug: false },
		{ type: 'ROWS', rows: [] }
	])
	f.emit({ type: 'CONNECTIVITY', online: false })
	f.emit({ type: 'CONNECTIVITY', online: true })
	expect(f.posts[2]).toEqual({ type: 'WAKE' })
	f.actor.send({ type: 'STOP' })
	await toPromise(f.actor)
	expect(f.order).toEqual(['quiesce', 'dispose', 'BACKGROUND_CLOSED'])
	expect(f.actor.getSnapshot().context.report).toBeUndefined()
	expect(f.actor.getSnapshot().context.tasks).toEqual({})
})
it('aborts network I/O and drains native writes plus outstanding reads before terminating', async () => {
	const save = Promise.withResolvers<ArticleSaveResult>(),
		network = Promise.withResolvers<RpcReply>(),
		lookup = Promise.withResolvers<RpcReply>()
	let signal: AbortSignal | undefined
	const f = fixture({
		save: () => save.promise,
		network: (s) => {
			signal = s
			return network.promise
		},
		lookup: () => lookup.promise
	})
	f.message(saveCall)
	f.message(networkCall)
	f.message({ type: 'CALL', id: 'read', method: 'document', operationId: 'document' })
	await vi.waitFor(() => expect(f.saved).toHaveBeenCalledOnce())
	f.actor.send({ type: 'STOP' })
	f.actor.send({ type: 'STOP' })
	expect(f.actor.getSnapshot().matches({ owning: 'draining' })).toBe(true)
	expect(f.saveShutdown).toHaveBeenCalledOnce()
	expect(signal?.aborted).toBe(true)
	expect(f.dispose).not.toHaveBeenCalled()
	f.message({ ...saveCall, id: 'late' })
	expect(f.saved).toHaveBeenCalledOnce()
	network.reject(new Error('aborted'))
	lookup.resolve({ method: 'document', exists: true })
	await waitFor(f.actor, (s) => Object.keys(s.context.tasks).length === 1)
	expect(f.dispose).not.toHaveBeenCalled()
	save.resolve({ kind: 'unknown', operationId: 'saved' })
	await toPromise(f.actor)
	expect(f.dispose).toHaveBeenCalledOnce()
	expect(f.report.mock.calls.map(([event]) => event.type)).toEqual(['BACKGROUND_CLOSED'])
	expect(f.posts.filter((p) => p.type === 'REPLY' || p.type === 'ERROR')).toEqual([])
})
it('worker failure drains an issued native save instead of dropping it', async () => {
	const save = Promise.withResolvers<ArticleSaveResult>()
	const f = fixture({ save: () => save.promise })
	f.message(saveCall)
	await vi.waitFor(() => expect(f.saved).toHaveBeenCalledOnce())
	f.emit({ type: 'RESOURCE_ERROR' })
	expect(f.saveShutdown).toHaveBeenCalledOnce()
	expect(f.dispose).not.toHaveBeenCalled()
	save.resolve({ kind: 'unknown', operationId: 'saved' })
	await toPromise(f.actor)
	expect(f.report.mock.calls.map(([event]) => event.type)).toEqual([
		'BACKGROUND_ERROR',
		'BACKGROUND_CLOSED'
	])
})
it('canceling a network RPC drains it without a late reply and keeps the host available', async () => {
	const network = Promise.withResolvers<RpcReply>()
	let signal: AbortSignal | undefined
	const f = fixture({
		network: (s) => {
			signal = s
			return network.promise
		}
	})
	f.message(networkCall)
	f.message({ type: 'CANCEL_CALL', id: 'fetch' })
	expect(signal?.aborted).toBe(true)
	network.reject(new Error('aborted'))
	await waitFor(f.actor, (s) => Object.keys(s.context.tasks).length === 0)
	expect(f.actor.getSnapshot().matches({ owning: 'running' })).toBe(true)
	expect(f.posts.filter((p) => p.type === 'REPLY' || p.type === 'ERROR')).toEqual([])
	f.actor.send({ type: 'STOP' })
	await toPromise(f.actor)
})
it('retries only after its native metadata write settles and drains it on shutdown', async () => {
	const gate = Promise.withResolvers<void>()
	const f = fixture({ persistFailure: () => gate.promise })
	f.actor.send({ type: 'RETRY', id: 'article' })
	await vi.waitFor(() => expect(f.persistFailure).toHaveBeenCalledOnce())
	expect(f.posts.some((p) => p.type === 'RETRY')).toBe(false)
	f.actor.send({ type: 'STOP' })
	expect(f.dispose).not.toHaveBeenCalled()
	gate.resolve()
	await toPromise(f.actor)
	expect(f.posts.some((p) => p.type === 'RETRY')).toBe(false)
})
it('forwards save receipts only to the main owner and ignores completions after scope loss', async () => {
	const receipt = { global: async () => {} }
	const f = fixture({
		save: async () => ({ kind: 'saved', operationId: 'saved', ready: true, receipts: [receipt] })
	})
	f.message(saveCall)
	await waitFor(f.actor, (s) => Object.keys(s.context.tasks).length === 0)
	expect(f.report).toHaveBeenCalledWith({
		type: 'BACKGROUND_SAVED',
		result: { kind: 'saved', operationId: 'saved', ready: true, receipts: [receipt] }
	})
	expect(f.posts).toContainEqual({
		type: 'REPLY',
		id: 'save',
		reply: { method: 'save', result: { kind: 'saved', operationId: 'saved', ready: true } }
	})
	f.expire()
	f.message({ ...saveCall, id: 'stale' })
	expect(f.saved).toHaveBeenCalledOnce()
	f.actor.send({ type: 'STOP' })
	await toPromise(f.actor)
})
it('reports worker startup failure and closes without a leaked resource', async () => {
	const f = fixture({ failOpen: true })
	await toPromise(f.actor)
	expect(f.report.mock.calls.map(([event]) => event.type)).toEqual([
		'BACKGROUND_ERROR',
		'BACKGROUND_CLOSED'
	])
	expect(f.dispose).not.toHaveBeenCalled()
})

it('forwards Retry after the native metadata receipt and keeps the worker running', async () => {
	const gate = Promise.withResolvers<void>()
	const f = fixture({ persistFailure: () => gate.promise })
	f.actor.send({ type: 'RETRY', id: 'article' })
	await vi.waitFor(() => expect(f.persistFailure).toHaveBeenCalledOnce())
	expect(f.posts.some((p) => p.type === 'RETRY')).toBe(false)
	gate.resolve()
	await waitFor(f.actor, (s) => Object.keys(s.context.tasks).length === 0)
	expect(f.posts).toContainEqual({ type: 'RETRY', id: 'article' })
	expect(f.report).not.toHaveBeenCalled()
	f.actor.send({ type: 'STOP' })
	await toPromise(f.actor)
})
it('does not forward an issued save completion to an expired account binding', async () => {
	const save = Promise.withResolvers<ArticleSaveResult>()
	const f = fixture({ save: () => save.promise })
	f.message(saveCall)
	await vi.waitFor(() => expect(f.saved).toHaveBeenCalledOnce())
	f.expire()
	save.resolve({ kind: 'saved', operationId: 'saved', ready: true, receipts: [] })
	await waitFor(f.actor, (s) => Object.keys(s.context.tasks).length === 0)
	expect(f.report).not.toHaveBeenCalled()
	expect(f.posts.filter((p) => p.type === 'REPLY' || p.type === 'ERROR')).toEqual([])
	f.actor.send({ type: 'STOP' })
	await toPromise(f.actor)
})
