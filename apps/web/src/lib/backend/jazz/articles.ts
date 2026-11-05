import { createOrganizationRecords } from './organization.js'
import { canAttachArticleContent, isPendingArticle } from '../../capture/article-policy.js'
import { stageAttachment } from '../../machines/storage/mutations.js'
import { createActor } from 'xstate'
import { createArticleCollectionMachine } from '../../machines/capture/article-collection.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import type { TransactionResource } from './transaction.js'
import { ReadTier } from 'jazz-tools'
import type { Db, WriteHandle } from 'jazz-tools'
import type { ActorLogic, Snapshot } from 'xstate'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { createSaveArticleMachine } from '../../machines/storage/save-article.js'
import { articleRecord, prepareArticle, uuid } from '../../capture/articles.js'
import type { Article, ArticleDraft, LibraryArticle } from '../../contracts/articles.js'
import type { SaveRequest, SaveResult, SyncReceipt } from '../../contracts/storage.js'
import { app } from './schema.js'
type Resource = TransactionResource
/** Reads stay bound to this DB/library; owning actors gate admission and late-result consumption.
 * Native write admission and commit scope protection live in transactionLifecycle. */
export function createArticleRecords<S extends Snapshot<SaveResult>>(
	db: Pick<Db, 'one' | 'beginTransaction' | 'subscribe'>,
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
	const ensure = createWorkspaceCreationTransaction<
		ArticleDraft,
		Resource,
		{ article: Article | null; available: boolean },
		SyncReceipt,
		WriteHandle
	>({
		...transactionLifecycle(db, isCurrent),
		readLocal: async (r, a) => {
			const row = await r.tx.one(app.articles.where({ id: a.draft.article.id, libraryId }), {
				tier: ReadTier.LocalFirst
			})

			return { article: row, available: false }
		},
		assess: (rows) =>
			!rows.article
				? { outcome: 'eligible' }
				: { outcome: 'blocked', reason: 'Article already exists or is unavailable' },
		stage: (r, a) => {
			const { id, ...row } = articleRecord(a.draft.article, libraryId)
			r.tx.insert(app.articles, row, { id })
			return transactionReceipt(r)
		}
	})
	const attach = createWorkspaceCreationTransaction<
		ArticleDraft,
		Resource,
		{ article: Article | null; available: boolean },
		SyncReceipt,
		WriteHandle
	>({
		...transactionLifecycle(db, isCurrent),
		readLocal: async (r, a) => {
			const article = await r.tx.one(app.articles.where({ id: a.draft.article.id, libraryId }), {
				tier: ReadTier.LocalFirst
			})
			r.article = article
			const available =
				(await r.tx.one(app.documents.where({ id: a.draft.target, libraryId }), {
					tier: ReadTier.LocalFirst
				})) !== null

			return { article, available }
		},
		assess: (rows) =>
			canAttachArticleContent(rows.article, rows.available)
				? { outcome: 'eligible' }
				: { outcome: 'blocked', reason: 'Article already exists or is unavailable' },
		stage: (r, a) =>
			stageAttachment({
				existingArticle: !!r.article,
				attachContent: () => {
					r.tx.update(app.articles, a.draft.article.id, {
						contentId: a.draft.target,
						failure: null
					})
				},
				createArticle: () => {
					const { id, ...row } = articleRecord(a.draft.article, libraryId)
					r.tx.insert(app.articles, { ...row, contentId: a.draft.target, failure: null }, { id })
				},
				receipt: () => transactionReceipt(r)
			})
	})

	const failure = createWorkspaceCreationTransaction<
		{ id: string; code: string | null },
		Resource,
		Article | null,
		SyncReceipt,
		WriteHandle
	>({
		...transactionLifecycle(db, isCurrent),
		readLocal: async (r, a) => {
			const row = await r.tx.one(app.articles.where({ id: uuid(a.draft.id), libraryId }), {
				tier: ReadTier.LocalFirst
			})

			return row
		},
		assess: (row) =>
			isPendingArticle(row)
				? { outcome: 'eligible' }
				: { outcome: 'blocked', reason: 'Article is complete or unavailable' },
		stage: (r, a) => {
			if (a.draft.code !== null && a.draft.code.length > 100)
				throw new Error('Invalid article failure')
			r.tx.update(app.articles, a.draft.id, { failure: a.draft.code })
			return transactionReceipt(r)
		}
	})
	const organization = createOrganizationRecords(db, libraryId, isCurrent)
	const collection = createArticleCollectionMachine({
		organization: organization.subscribe,
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
