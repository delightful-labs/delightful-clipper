import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { createSaveArticleMachine } from './save-article.js'
import { createSaveRecordMachine } from './save.js'
import type { ArticleDraft } from '../../contracts/articles.js'
import type { PreparedSave, SyncReceipt } from '../../contracts/storage.js'
const draft: ArticleDraft = {
	article: {
		id: 'article',
		libraryId: 'library',
		url: 'https://example.com/',
		originalSavedAt: '2026-11-04',
		contentId: null,
		operationId: null,
		failure: null
	},
	target: 'content'
}
function transaction<Draft>(blocked = false) {
	return createWorkspaceCreationTransaction<Draft, object, null, SyncReceipt, object>({
		open: () => ({}),
		readLocal: async () => null,
		assess: () =>
			blocked ? { outcome: 'blocked', reason: 'already exists' } : { outcome: 'eligible' },
		stage: () => ({ global: async () => {} }),
		commit: () => ({}),
		persistLocal: async () => {},
		rollback: () => true
	})
}
function fixture(phase: 'prepare' | 'read' | 'document' | 'intent' | 'reread', current = true) {
	const gate = Promise.withResolvers<void>(),
		entered = Promise.withResolvers<void>()
	const pause = async (name: string) => {
		if (name === phase) {
			entered.resolve()
			await gate.promise
		}
	}
	const prepare = vi.fn(async () => {
		await pause('prepare')
		return draft
	})
	let reads = 0
	const read = vi.fn(async () => {
		await pause(++reads === 1 ? 'read' : 'reread')
		return phase === 'read' ? draft.article : null
	})
	const document = vi.fn(async () => {
		await pause('document')
		return phase === 'document'
			? {
					id: 'content',
					libraryId: 'library',
					operationId: 'operation',
					snapshotId: 'snapshot',
					assetId: 'asset',
					title: 'Old account content',
					originalSavedAt: '2026-11-04'
				}
			: null
	})
	const intent = vi.fn(async () => {
		await pause('intent')
		return false
	})
	const contentStage = transaction<PreparedSave>()
	const content = createSaveRecordMachine({
		isCurrent: () => current,
		prepare: async () => {
			throw new Error('Unexpected content save')
		},
		intent: contentStage,
		publish: contentStage
	})
	const stage = transaction<ArticleDraft>(phase === 'reread')
	const actor = createActor(
		createSaveArticleMachine({
			isCurrent: () => current,
			prepare,
			read,
			document,
			intent,
			ensure: stage,
			attach: stage,
			content
		}),
		{ input: { url: draft.article.url } }
	).start()
	return {
		actor,
		prepare,
		read,
		document,
		intent,
		entered: entered.promise,
		gate,
		stale: () => {
			current = false
		}
	}
}
it('rejects a stale binding before admitting preparation or native reads', async () => {
	const f = fixture('read', false)
	expect((await toPromise(f.actor)).kind).toBe('scopeChanged')
	expect(f.prepare).not.toHaveBeenCalled()
	expect(f.read).not.toHaveBeenCalled()
})
it.each(['prepare', 'read', 'document', 'intent', 'reread'] as const)(
	'discards a late %s result after scope loss without admitting the next operation',
	async (phase) => {
		const f = fixture(phase)
		await f.entered
		f.stale()
		expect(f.actor.getSnapshot().status).toBe('active')
		const calls = [
			f.read.mock.calls.length,
			f.document.mock.calls.length,
			f.intent.mock.calls.length
		]
		f.gate.resolve()
		expect((await toPromise(f.actor)).kind).toBe('scopeChanged')
		expect([
			f.read.mock.calls.length,
			f.document.mock.calls.length,
			f.intent.mock.calls.length
		]).toEqual(calls)
		expect(f.actor.getSnapshot().context).toMatchObject({
			request: undefined,
			draft: undefined,
			existing: null
		})
	}
)
it('classifies a late reread failure through the owner scope guard', async () => {
	const f = fixture('reread')
	await f.entered
	f.stale()
	f.gate.reject(new Error('old account read failed'))
	expect((await toPromise(f.actor)).kind).toBe('scopeChanged')
})
it('drains an issued read on shutdown and admits no subsequent lookup', async () => {
	const f = fixture('read')
	await f.entered
	f.actor.send({ type: 'SHUTDOWN' })
	expect(f.actor.getSnapshot().status).toBe('active')
	f.gate.resolve()
	expect((await toPromise(f.actor)).kind).toBe('interrupted')
	expect(f.document).not.toHaveBeenCalled()
})

it.each(['prepare', 'read', 'document', 'intent', 'reread'] as const)(
	'drains %s after repeated shutdown without admitting another operation',
	async (phase) => {
		const f = fixture(phase)
		await f.entered
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type: 'SHUTDOWN' })
		const calls = [
			f.prepare.mock.calls.length,
			f.read.mock.calls.length,
			f.document.mock.calls.length,
			f.intent.mock.calls.length
		]
		expect(f.actor.getSnapshot().status).toBe('active')
		f.gate.resolve()
		expect((await toPromise(f.actor)).kind).toBe('interrupted')
		expect([
			f.prepare.mock.calls.length,
			f.read.mock.calls.length,
			f.document.mock.calls.length,
			f.intent.mock.calls.length
		]).toEqual(calls)
	}
)

it.each([
	['ensure', 'resolve'],
	['ensure', 'reject'],
	['attach', 'resolve'],
	['attach', 'reject']
] as const)(
	'drains the %s local write through %s after repeated shutdown',
	async (phase, settlement) => {
		const gate = Promise.withResolvers<void>()
		const persistLocal = vi.fn(() => gate.promise)
		const commit = vi.fn(() => ({}))
		const stage = createWorkspaceCreationTransaction<
			ArticleDraft,
			object,
			null,
			SyncReceipt,
			object
		>({
			open: () => ({}),
			readLocal: async () => null,
			assess: () => ({ outcome: 'eligible' }),
			stage: () => ({ global: async () => {} }),
			commit,
			persistLocal,
			rollback: () => true
		})
		const contentStage = transaction<PreparedSave>()
		const content = createSaveRecordMachine({
			isCurrent: () => true,
			prepare: async () => {
				throw new Error('Unexpected content save')
			},
			intent: contentStage,
			publish: contentStage
		})
		const actor = createActor(
			createSaveArticleMachine({
				isCurrent: () => true,
				prepare: async () => draft,
				read: async () => null,
				document: async () =>
					phase === 'attach'
						? {
								id: 'content',
								libraryId: 'library',
								operationId: 'operation',
								snapshotId: 'snapshot',
								assetId: 'asset',
								title: 'Existing',
								originalSavedAt: '2026-11-04'
							}
						: null,
				intent: async () => false,
				ensure: stage,
				attach: stage,
				content
			}),
			{ input: { url: draft.article.url } }
		).start()
		await vi.waitFor(() => expect(persistLocal).toHaveBeenCalledOnce())
		actor.send({ type: 'SHUTDOWN' })
		actor.send({ type: 'SHUTDOWN' })
		expect(actor.getSnapshot().status).toBe('active')
		expect(commit).toHaveBeenCalledOnce()
		if (settlement === 'resolve') gate.resolve()
		else gate.reject(new Error('unknown local durability'))
		expect((await toPromise(actor)).kind).toBe(settlement === 'resolve' ? 'interrupted' : 'unknown')
		expect(actor.getSnapshot().context.draft).toBeUndefined()
	}
)
