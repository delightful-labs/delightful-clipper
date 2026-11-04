import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { createArticleWorkerCallMachine } from './article-worker-call.js'
import type { FailureDraft, HostCall } from './article-worker-call.js'
import type { ArticleSaveResult } from '../../contracts/articles.js'
import type { RpcReply } from '../../contracts/article-worker.js'
import type { SyncReceipt } from '../../contracts/storage.js'
import { controlledSave } from './library.test-support.js'

function fixture(call: HostCall) {
	let current = true
	const reply = Promise.withResolvers<RpcReply>()
	const saved = Promise.withResolvers<ArticleSaveResult>()
	const persisted = Promise.withResolvers<void>()
	const shutdown = vi.fn()
	const save = controlledSave(() => saved.promise, shutdown)
	const global = vi.fn(async () => {})
	const persistLocal = vi.fn(() => persisted.promise)
	const failure = createWorkspaceCreationTransaction<
		FailureDraft,
		object,
		null,
		SyncReceipt,
		object
	>({
		open: () => ({}),
		readLocal: async () => null,
		assess: () => ({ outcome: 'eligible' }),
		stage: () => ({ global }),
		commit: () => ({}),
		persistLocal,
		rollback: () => true
	})
	let signal: AbortSignal | undefined
	const network = vi.fn(async (_call: unknown, next: AbortSignal) => {
		signal = next
		return reply.promise
	})
	const lookup = vi.fn(() => reply.promise)
	const actor = createActor(
		createArticleWorkerCallMachine({ isCurrent: () => current, network, lookup, save, failure }),
		{ input: call }
	).start()
	return {
		actor,
		reply,
		saved,
		persisted,
		shutdown,
		global,
		persistLocal,
		network,
		lookup,
		signal: () => signal,
		stale: () => {
			current = false
		}
	}
}
const calls = {
	network: {
		type: 'CALL',
		id: 'call',
		method: 'resolve',
		url: 'https://example.com/',
		requestId: 'request'
	},
	lookup: { type: 'CALL', id: 'call', method: 'document', operationId: 'operation' },
	save: { type: 'CALL', id: 'call', method: 'save', request: { url: 'https://example.com/' } }
} as const satisfies Record<string, HostCall>

it.each(['network', 'lookup', 'save'] as const)(
	'drains %s on repeated shutdown and suppresses its late result',
	async (method) => {
		const f = fixture(calls[method])
		await vi.waitFor(() =>
			expect(
				f.actor.getSnapshot().matches({ running: { work: method === 'save' ? 'saving' : method } })
			).toBe(true)
		)
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'SHUTDOWN' })
		expect(f.actor.getSnapshot().status).toBe('active')
		if (method === 'network') expect(f.signal()?.aborted).toBe(true)
		if (method === 'save') expect(f.shutdown).toHaveBeenCalledOnce()
		f.reply.resolve({ method: 'document', exists: true })
		f.saved.resolve({ kind: 'saved', operationId: 'saved', ready: true, receipts: [] })
		expect(await toPromise(f.actor)).toEqual({ id: 'call' })
		expect(f.actor.getSnapshot().context.call).toBeUndefined()
	}
)

it.each(['resolve', 'reject'] as const)(
	'suppresses a stale lookup %s through completion guards',
	async (settlement) => {
		const f = fixture(calls.lookup)
		await vi.waitFor(() => expect(f.lookup).toHaveBeenCalledOnce())
		f.stale()
		if (settlement === 'resolve') f.reply.resolve({ method: 'document', exists: true })
		else f.reply.reject(new Error('networkUnavailable'))
		expect(await toPromise(f.actor)).toEqual({ id: 'call' })
	}
)

it('drains failure persistence on shutdown without reporting retry or starting remote acceptance', async () => {
	const f = fixture({ type: 'RETRY', id: 'article' })
	await vi.waitFor(() => expect(f.persistLocal).toHaveBeenCalledOnce())
	f.actor.send({ type: 'SHUTDOWN' })
	f.actor.send({ type: 'SHUTDOWN' })
	expect(f.actor.getSnapshot().status).toBe('active')
	f.persisted.resolve()
	expect(await toPromise(f.actor)).toEqual({ id: 'article' })
	expect(f.global).not.toHaveBeenCalled()
})

it('reports active failures and retries only while the binding remains current', async () => {
	const failed = fixture(calls.network)
	failed.reply.reject(new Error('sourceTooLarge'))
	expect(await toPromise(failed.actor)).toEqual({ id: 'call', error: 'sourceTooLarge' })
	const retry = fixture({ type: 'RETRY', id: 'article' })
	await vi.waitFor(() => expect(retry.persistLocal).toHaveBeenCalledOnce())
	retry.persisted.resolve()
	expect(await toPromise(retry.actor)).toEqual({ id: 'article', retry: 'article' })
	expect(retry.global).toHaveBeenCalledOnce()
})
