import { createOrganizationRecords } from './organization.js'
import {
	createArticleEnsureDomain,
	createArticleAttachmentDomain,
	createArticleFailureDomain
} from '../../machines/storage/article-domains.js'
import type { ArticleFailure } from '../../machines/storage/article-domains.js'
import { createDomainTransaction } from '../../machines/storage/domain-transaction.js'
import { createActor } from 'xstate'
import { createArticleCollectionMachine } from '../../machines/capture/article-collection.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import type { TransactionResource } from './transaction.js'
import { ReadTier } from 'jazz-tools'
import type { Db } from 'jazz-tools'
import type { ActorLogic, Snapshot } from 'xstate'
import { createSaveArticleMachine } from '../../machines/storage/save-article.js'
import { articleRecord, prepareArticle, uuid } from '../../capture/articles.js'
import type { Article, ArticleDraft, LibraryArticle } from '../../contracts/articles.js'
import type { SaveRequest, SaveResult } from '../../contracts/storage.js'
import { app } from './schema.js'
/** Reads stay bound to this DB/library; owning actors gate admission and late-result consumption.
 * Native write admission and commit scope protection live in transactionLifecycle. */
export function createArticleRecords<S extends Snapshot<SaveResult>>(
	db: Pick<Db, 'one' | 'all' | 'beginTransaction' | 'subscribe'>,
	libraryId: string,
	isCurrent: () => boolean,
	content: ActorLogic<S, { type: 'SHUTDOWN' }, SaveRequest>
) {
	const read = async (id: string) => {
		const row = await db.one(app.articles.where({ id: uuid(id), libraryId }), {
			tier: ReadTier.LocalFirst
		})

		return row ? articleRecord(row, libraryId) : null
	}
	const document = async (id: string) => {
		const row = await db.one(app.documents.where({ id: uuid(id), libraryId }), {
			tier: ReadTier.LocalFirst
		})

		return row
	}
	const intent = async (id: string) => {
		const row = await db.one(app.storageOperations.where({ id: uuid(id), libraryId }), {
			tier: ReadTier.LocalFirst
		})

		return row !== null
	}
	const lifecycle = transactionLifecycle(db, isCurrent)
	const readArticle = async (resource: TransactionResource, draft: ArticleDraft) => {
		const article = await resource.tx.one(app.articles.where({ id: draft.article.id, libraryId }), {
			tier: ReadTier.LocalFirst
		})
		return { draft, article }
	}
	const ensure = createDomainTransaction<ArticleDraft>(
		createArticleEnsureDomain({
			read: readArticle,
			insertArticle: (resource, { draft }) => {
				const { id, ...row } = articleRecord(draft.article, libraryId)
				resource.tx.insert(app.articles, row, { id })
			},
			receipt: transactionReceipt
		}),
		lifecycle
	)
	const attach = createDomainTransaction<ArticleDraft>(
		createArticleAttachmentDomain({
			read: async (resource, draft) => {
				const facts = await readArticle(resource, draft)
				const document = await resource.tx.one(
					app.documents.where({ id: draft.target, libraryId }),
					{ tier: ReadTier.LocalFirst }
				)
				return { ...facts, available: document !== null }
			},
			attachContent: (resource, { draft }) => {
				resource.tx.update(app.articles, draft.article.id, {
					contentId: draft.target,
					failure: null
				})
			},
			createArticle: (resource, { draft }) => {
				const { id, ...row } = articleRecord(draft.article, libraryId)
				resource.tx.insert(app.articles, { ...row, contentId: draft.target, failure: null }, { id })
			},
			receipt: transactionReceipt
		}),
		lifecycle
	)
	const failure = createDomainTransaction<ArticleFailure>(
		createArticleFailureDomain({
			read: async (resource, draft) => {
				const article = await resource.tx.one(
					app.articles.where({ id: uuid(draft.id), libraryId }),
					{ tier: ReadTier.LocalFirst }
				)
				return { draft, article }
			},
			recordFailure: (resource, { draft }) => {
				if (draft.code !== null && draft.code.length > 100)
					throw new Error('Invalid article failure')
				resource.tx.update(app.articles, draft.id, { failure: draft.code })
			},
			receipt: transactionReceipt
		}),
		lifecycle
	)

	const organization = createOrganizationRecords(db, libraryId, isCurrent)
	const collection = createArticleCollectionMachine({
		organization: organization.subscribe,
		tags: organization.subscribeTags,
		isCurrent,
		articles: (next, error) =>
			db.subscribe(
				app.articles.where({ libraryId }),
				{
					onUpdate: (rows) => next(rows.map((row) => articleRecord(row, libraryId))),
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			),
		documents: (next, error) =>
			db.subscribe(
				app.documents.where({ libraryId }),
				{
					onUpdate: next,
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			)
	})

	return {
		libraryId,
		organization,
		read,
		document,
		intent,
		failure,
		saveMachine: createSaveArticleMachine({
			isCurrent,
			prepare: (request) => prepareArticle(libraryId, request),
			read,
			document,
			intent,
			ensure,
			attach,
			content
		}),
		subscribePending: (next: (rows: Article[]) => void, error: () => void) =>
			db.subscribe(
				app.articles.where({ libraryId, contentId: null }),
				{
					onUpdate: (rows) => {
						next(rows.map((row) => articleRecord(row, libraryId)))
					},
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			),
		subscribe: (next: (rows: LibraryArticle[]) => void, error: () => void) => {
			const actor = createActor(
				collection,

				{ input: { next, error } }
			).start()
			return () => {
				actor.send({ type: 'STOP' })
				actor.stop()
			}
		}
	}
}
