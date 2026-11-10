import { Transaction } from 'jazz-tools'
import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'

import type { TransactionResource } from '../../backend/jazz/transaction.js'
import { createDomainTransaction, type DomainSpawner } from './domain-transaction.js'
import { createContentIntentDomain, createContentPublicationDomain } from './content-domains.js'
import { createArticleAttachmentDomain } from './article-domains.js'
import { createOrganizationDomain } from './organization-domain.js'
import { createImagePublicationDomain } from './image-domains.js'
import type { PreparedSave } from '../../contracts/storage.js'
import type { Article, ArticleDraft } from '../../contracts/articles.js'
import type { OrganizationDraft } from './organize.js'
import type { ArticleImage, ReadyImageWrite } from '../../images/schema.js'
function fixture() {
	const order: string[] = [],
		receipt = { global: vi.fn(async () => {}) }
	const resource: TransactionResource = {
		tx: new Transaction('mergeable', () => {
			throw new Error('Domain stubs must not bind a native table')
		}),
		commit: () => {
			throw new Error('The DLF lifecycle owns commit')
		},
		global: async () => {}
	}
	const rollback = vi.fn(async () => true),
		commit = vi.fn(() => ({}))
	const leaf = (name: string) =>
		vi.fn(() => {
			order.push(name)
		})
	async function run<Draft>(domain: DomainSpawner<Draft>, draft: Draft) {
		const logic = createDomainTransaction<Draft, TransactionResource, object>(domain, {
			retainDetached: vi.fn(),
			open: () => resource,
			commit,
			persistLocal: async () => {},
			rollback
		})
		return toPromise(
			createActor(logic, {
				input: {
					attempt: {
						operationId: 'operation',
						workspaceId: 'workspace',
						membershipId: 'membership',
						draft
					}
				}
			}).start()
		)
	}
	return { order, receipt, leaf, run, commit, rollback }
}
function content(articleLinked: boolean, hasSource = articleLinked): PreparedSave {
	return {
		intent: { id: 'operation', libraryId: 'library', payloadHash: 'hash', createdAt: '2026-11-06' },
		asset: {
			id: 'asset',
			libraryId: 'library',
			operationId: 'operation',
			mediaType: 'text/plain',
			payload: new Uint8Array([1])
		},
		snapshot: {
			id: 'snapshot',
			libraryId: 'library',
			documentId: 'document',
			text: 'authored',
			formatVersion: '1'
		},
		document: {
			id: 'document',
			libraryId: 'library',
			operationId: 'operation',
			snapshotId: 'snapshot',
			assetId: 'asset',
			title: 'Title',
			originalSavedAt: '2026-11-06'
		},
		...(articleLinked ? { articleId: 'article' } : {}),
		...(hasSource
			? {
					source: {
						id: 'document',
						libraryId: 'library',
						documentId: 'document',
						submittedUrl: 'https://example.com/',
						finalUrl: 'https://example.com/',
						provenance: 'test'
					}
				}
			: {})
	}
}
function article(operationId: string | null = null): Article {
	return {
		id: 'article',
		libraryId: 'library',
		url: 'https://example.com/',
		originalSavedAt: '2026-11-06',
		contentId: null,
		operationId,
		failure: null
	}
}
it.each([
	{ linked: false, exists: false, expected: ['intent'] },
	{ linked: true, exists: false, expected: ['intent', 'create'] },
	{ linked: true, exists: true, expected: ['intent', 'bind'] }
])(
	'selects intent mutations from retained transaction facts: $expected',
	async ({ linked, exists, expected }) => {
		const f = fixture(),
			draft = content(linked)
		const result = await f.run(
			(spawn, input) =>
				spawn(
					createContentIntentDomain({
						read: async () => ({
							draft,
							operationId: 'operation',
							intent: null,
							article: exists ? article() : null
						}),
						insertIntent: f.leaf('intent'),
						createArticle: f.leaf('create'),
						bindArticle: f.leaf('bind'),
						receipt: () => f.receipt
					}),
					{ input }
				),
			draft
		)
		expect(result.settlement.kind).toBe('locallyPersisted')
		expect(f.order).toEqual(expected)
		expect(f.commit).toHaveBeenCalledOnce()
	}
)
it.each([
	{ linked: false, source: false, expected: ['content'] },
	{ linked: false, source: true, expected: ['content', 'source'] },
	{ linked: true, source: true, expected: ['content', 'attach', 'source'] }
])(
	'publishes content, attachment and provenance in the selected order: $expected',
	async ({ linked, source, expected }) => {
		const f = fixture(),
			draft = content(linked, source)
		await f.run(
			(spawn, input) =>
				spawn(
					createContentPublicationDomain({
						read: async () => ({
							draft,
							operationId: 'operation',
							intent: draft.intent,
							article: linked ? article('operation') : null
						}),
						publishContent: f.leaf('content'),
						attachContent: f.leaf('attach'),
						publishSource: f.leaf('source'),
						receipt: () => f.receipt
					}),
					{ input }
				),
			draft
		)
		expect(f.order).toEqual(expected)
		expect(f.receipt.global).not.toHaveBeenCalled()
	}
)
it('blocks an existing intent on read completion before issuing any mutations', async () => {
	const f = fixture(),
		draft = content(true)
	const result = await f.run(
		(spawn, input) =>
			spawn(
				createContentIntentDomain({
					read: async () => ({
						draft,
						operationId: 'operation',
						intent: draft.intent,
						article: article()
					}),
					insertIntent: f.leaf('intent'),
					createArticle: f.leaf('create'),
					bindArticle: f.leaf('bind'),
					receipt: () => f.receipt
				}),
				{ input }
			),
		draft
	)
	expect(result.outcome).toBe('blocked')
	expect(f.order).toEqual([])
	expect(f.commit).not.toHaveBeenCalled()
	expect(f.rollback).toHaveBeenCalledOnce()
})
it('blocks mismatched publication facts on read completion before issuing any mutations', async () => {
	const f = fixture(),
		draft = content(true)
	const result = await f.run(
		(spawn, input) =>
			spawn(
				createContentPublicationDomain({
					read: async () => ({
						draft,
						operationId: 'operation',
						intent: { ...draft.intent, payloadHash: 'other' },
						article: article('operation')
					}),
					publishContent: f.leaf('content'),
					attachContent: f.leaf('attach'),
					publishSource: f.leaf('source'),
					receipt: () => f.receipt
				}),
				{ input }
			),
		draft
	)
	expect(result.outcome).toBe('blocked')
	expect(f.order).toEqual([])
	expect(f.commit).not.toHaveBeenCalled()
	expect(f.rollback).toHaveBeenCalledOnce()
})
it.each(['content', 'attach', 'source'] as const)(
	'rolls back a failed %s action without running later actions or completing the child',
	async (failure) => {
		const f = fixture(),
			draft = content(true)
		const receipt = vi.fn(() => f.receipt)
		const mutation = (name: string) => () => {
			f.order.push(name)
			if (name === failure) throw new Error('Native mutation failed')
		}
		const result = await f.run(
			(spawn, input) =>
				spawn(
					createContentPublicationDomain({
						read: async () => ({
							draft,
							operationId: 'operation',
							intent: draft.intent,
							article: article('operation')
						}),
						publishContent: mutation('content'),
						attachContent: mutation('attach'),
						publishSource: mutation('source'),
						receipt
					}),
					{ input }
				),
			draft
		)
		const sequence = ['content', 'attach', 'source']
		expect(f.order).toEqual(sequence.slice(0, sequence.indexOf(failure) + 1))
		expect(receipt).not.toHaveBeenCalled()
		expect(f.commit).not.toHaveBeenCalled()
		expect(f.rollback).toHaveBeenCalledOnce()
		expect(result.settlement.kind).toBe('notStarted')
	}
)
it.each([true, false])(
	'selects the attachment mutation from the retained article row (exists: %s)',
	async (exists) => {
		const f = fixture(),
			draft: ArticleDraft = { article: article(), target: 'document' }
		await f.run(
			(spawn, input) =>
				spawn(
					createArticleAttachmentDomain({
						read: async () => ({ draft, article: exists ? article() : null, available: true }),
						attachContent: f.leaf('attach'),
						createArticle: f.leaf('create'),
						receipt: () => f.receipt
					}),
					{ input }
				),
			draft
		)
		expect(f.order).toEqual([exists ? 'attach' : 'create'])
	}
)
it('returns a thrown native mutation to DLF without issuing attachment or provenance writes', async () => {
	const f = fixture(),
		draft = content(true)
	const result = await f.run(
		(spawn, input) =>
			spawn(
				createContentPublicationDomain({
					read: async () => ({
						draft,
						operationId: 'operation',
						intent: draft.intent,
						article: article('operation')
					}),
					publishContent: () => {
						throw new Error('native staging failed')
					},
					attachContent: f.leaf('attach'),
					publishSource: f.leaf('source'),
					receipt: () => f.receipt
				}),
				{ input }
			),
		draft
	)
	expect(result.settlement.kind).toBe('notStarted')
	expect(f.order).toEqual([])
	expect(f.commit).not.toHaveBeenCalled()
	expect(f.rollback).toHaveBeenCalledOnce()
})
for (const parent of ['article', 'document'] as const) {
	for (const kind of ['scalar', 'tag'] as const) {
		it(`selects exactly the ${kind} ${parent} organization write`, async () => {
			const f = fixture()
			const draft: OrganizationDraft =
				kind === 'tag'
					? { id: 'article', field: 'tag', value: 'Work', assigned: true, operations: [] }
					: { id: 'article', field: 'favorite', value: true, operations: [] }
			await f.run(
				(spawn, input) =>
					spawn(
						createOrganizationDomain({
							read: async () => ({
								draft,
								operationId: 'operation',
								article: parent === 'article' ? {} : null,
								document: parent === 'document' ? {} : null,
								parents: ['observed']
							}),
							insertArticle: f.leaf('scalar-article'),
							insertDocument: f.leaf('scalar-document'),
							insertTagArticle: f.leaf('tag-article'),
							insertTagDocument: f.leaf('tag-document'),
							receipt: () => f.receipt
						}),
						{ input }
					),
				draft
			)
			expect(f.order).toEqual([`${kind}-${parent}`])
		})
	}
}
it('blocks a missing organization parent before issuing any mutation', async () => {
	const f = fixture(),
		draft: OrganizationDraft = { id: 'article', field: 'favorite', value: true, operations: [] }
	const result = await f.run(
		(spawn, input) =>
			spawn(
				createOrganizationDomain({
					read: async () => ({
						draft,
						operationId: 'operation',
						article: null,
						document: null,
						parents: []
					}),
					insertArticle: f.leaf('article'),
					insertDocument: f.leaf('document'),
					insertTagArticle: f.leaf('tag-article'),
					insertTagDocument: f.leaf('tag-document'),
					receipt: () => f.receipt
				}),
				{ input }
			),
		draft
	)
	expect(result.outcome).toBe('blocked')
	expect(f.order).toEqual([])
	expect(f.rollback).toHaveBeenCalledOnce()
})
it('uses the prepared image facts and stages intent, bytes and publication in order', async () => {
	const f = fixture()
	const image: ArticleImage = {
		id: 'image',
		libraryId: 'library',
		documentId: 'document',
		sourceUrl: 'https://example.com/image.png',
		status: 'pending',
		assetId: null,
		retryable: true
	}
	const draft: ReadyImageWrite = {
		kind: 'ready',
		image,
		result: { bytes: new Uint8Array([1]), mediaType: 'image/png', width: 1, height: 1 }
	}
	await f.run(
		(spawn, input) =>
			spawn(
				createImagePublicationDomain({
					read: async () => ({ draft, image, intent: null, hash: 'prepared hash' }),
					insertIntent: f.leaf('intent'),
					insertAsset: f.leaf('bytes'),
					publishImage: f.leaf('publish'),
					receipt: () => f.receipt
				}),
				{ input }
			),
		draft
	)
	expect(f.order).toEqual(['intent', 'bytes', 'publish'])
})
