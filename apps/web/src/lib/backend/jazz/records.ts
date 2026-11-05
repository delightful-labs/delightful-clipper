import { canBindArticleIntent, canPublishArticleContent } from '../../capture/article-policy.js'
import { stageIntent, stagePublication } from '../../machines/storage/mutations.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import type { TransactionResource } from './transaction.js'
import type { ReadCapabilities } from '../../contracts/storage.js'
import { ReadTier } from 'jazz-tools'
import type { Db, WriteHandle } from 'jazz-tools'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import type { PreparedSave, StorageIntent, SyncReceipt } from '../../contracts/storage.js'
import { createSaveRecordMachine } from '../../machines/storage/save.js'
import { prepareSave } from '../../storage/prepare.js'
import { app } from './schema.js'
import { insertPreparedContent } from './content.js'
import { createFakeDataRecords } from './fake-data.js'
import { createArticleRecords } from './articles.js'
import type { SearchDocument } from '../../search/schema.js'
import type { LibraryArticle } from '../../contracts/articles.js'
import type { Article } from '../../contracts/articles.js'

type Resource = TransactionResource
type StageRows = { intent: StorageIntent | null; article: Article | null }
function required<T>(value: T | undefined): T {
	if (value === undefined) throw new Error('Missing storage mutation input')
	return value
}
/** Evaluated against rows read inside the same transaction as the mutation. */
function canBindIntent(rows: StageRows, draft: PreparedSave) {
	return rows.intent === null && canBindArticleIntent(rows.article, draft)
}
function canPublishContent(rows: StageRows, draft: PreparedSave, operationId: string) {
	return (
		rows.intent?.payloadHash === draft.intent.payloadHash &&
		canPublishArticleContent(rows.article, draft, operationId)
	)
}

/** Reads stay bound to this DB/library; owning actors gate admission and late-result consumption.
 * Native write admission and commit scope protection live in transactionLifecycle. */
export function createLibraryRecords(
	db: Pick<Db, 'one' | 'all' | 'beginTransaction' | 'beginExclusiveTransaction' | 'subscribe'>,
	libraryId: string,
	isCurrent: () => boolean
) {
	const readLocal = async (
		resource: Resource,
		attempt: { operationId: string; draft: PreparedSave }
	) => {
		const row = await resource.tx.one(
			app.storageOperations.where({ id: attempt.operationId, libraryId }),
			{ tier: ReadTier.LocalFirst }
		)

		const article = attempt.draft.articleId
			? await resource.tx.one(app.articles.where({ id: attempt.draft.articleId, libraryId }), {
					tier: ReadTier.LocalFirst
				})
			: null

		resource.article = article
		return { intent: row, article }
	}
	const intent = createWorkspaceCreationTransaction<
		PreparedSave,
		Resource,
		StageRows,
		SyncReceipt,
		WriteHandle
	>({
		...transactionLifecycle(db, isCurrent),
		readLocal,
		assess: (rows, attempt) =>
			canBindIntent(rows, attempt.draft)
				? { outcome: 'eligible' }
				: { outcome: 'blocked', reason: 'Operation identity is not eligible' },
		stage: (resource, { draft }) =>
			stageIntent({
				articleLinked: !!draft.articleId,
				existingArticle: !!resource.article,
				insertIntent: () => {
					const { id, ...intent } = draft.intent
					resource.tx.insert(app.storageOperations, intent, { id })
				},
				bindArticle: () => {
					resource.tx.update(app.articles, required(draft.articleId), {
						operationId: draft.intent.id,
						failure: null
					})
				},
				createArticle: () => {
					resource.tx.insert(
						app.articles,
						{
							libraryId,
							url: required(draft.source).submittedUrl,
							originalSavedAt: draft.intent.createdAt,
							contentId: null,
							operationId: draft.intent.id,
							failure: null
						},
						{ id: required(draft.articleId) }
					)
				},
				receipt: () => transactionReceipt(resource)
			})
	})
	const publish = createWorkspaceCreationTransaction<
		PreparedSave,
		Resource,
		StageRows,
		SyncReceipt,
		WriteHandle
	>({
		...transactionLifecycle(db, isCurrent),
		readLocal,
		assess: (rows, attempt) =>
			canPublishContent(rows, attempt.draft, attempt.operationId)
				? { outcome: 'eligible' }
				: { outcome: 'blocked', reason: 'Operation identity is not eligible' },
		stage: (resource, { draft }) =>
			stagePublication({
				articleLinked: !!draft.articleId,
				hasSource: !!draft.source,
				publishContent: () => insertPreparedContent(resource.tx, draft),
				attachContent: () => {
					resource.tx.update(app.articles, required(draft.articleId), {
						contentId: draft.document.id,
						failure: null
					})
				},
				publishSource: () => {
					const { id, ...source } = required(draft.source)
					resource.tx.insert(app.articleSources, source, { id })
				},
				receipt: () => transactionReceipt(resource)
			})
	})

	const records = {
		binding: Object.freeze({}),
		saveMachine: createSaveRecordMachine({
			isCurrent,
			prepare: (request) => prepareSave(libraryId, request),
			intent,
			publish
		}),
		readCapabilities: {
			isCurrent,
			document: async (id) => {
				const article = await db.one(app.articles.where({ id, libraryId }), {
					tier: ReadTier.LocalFirst
				})
				const row = await db.one(app.documents.where({ id: article?.contentId ?? id, libraryId }), {
					tier: ReadTier.LocalFirstUnlessEmpty
				})

				return row && article ? { ...row, id: article.id } : row
			},
			snapshot: async (id) => {
				const row = await db.one(app.snapshots.where({ id, libraryId }), {
					tier: ReadTier.LocalFirstUnlessEmpty
				})

				return row
			},
			asset: async (id) => {
				const row = await db.one(app.assets.where({ id, libraryId }), {
					tier: ReadTier.LocalFirstUnlessEmpty
				})

				return row
			},
			source: async (id, signal) => {
				signal.throwIfAborted()
				const article = await db.one(app.articles.where({ id, libraryId }), {
					tier: ReadTier.LocalFirst
				})
				const target = article?.contentId ?? id
				const row = await db.one(app.articleSources.where({ id: target, libraryId }), {
					tier: ReadTier.LocalFirst
				})

				signal.throwIfAborted()
				return row && article && row.documentId === target
					? { ...row, id: article.id, documentId: article.id, submittedUrl: article.url }
					: row
			}
		} satisfies ReadCapabilities
	}
	return {
		...records,
		fakeData: createFakeDataRecords(db, libraryId, isCurrent),
		searchDocuments: async (
			rows: LibraryArticle[],
			_signal: AbortSignal
		): Promise<SearchDocument[]> => {
			const [documents, snapshots] = await Promise.all([
				db.all(app.documents.where({ libraryId }), { tier: ReadTier.LocalFirst }),
				db.all(app.snapshots.where({ libraryId }), { tier: ReadTier.LocalFirst })
			])
			const docs = new Map(documents.map((document) => [document.id, document]))
			const texts = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot.text]))
			return rows.map((row) => ({
				id: row.id,
				title: row.title,
				url: row.url ?? '',
				text: texts.get(docs.get(row.contentId ?? row.id)?.snapshotId ?? '') ?? '',
				tags: (row.tags ?? []).map((tag) => tag.name).join(' '),
				originalSavedAt: row.originalSavedAt
			}))
		},
		observeSearch: (dirty: () => void, error: () => void) =>
			db.subscribe(
				app.snapshots.where({ libraryId }),
				{ onUpdate: dirty, onError: error },
				{ tier: ReadTier.LocalFirst }
			),
		articles: createArticleRecords(db, libraryId, isCurrent, records.saveMachine),
		isCurrent,
		hasDocument: async (id: string) => {
			const row = await db.one(app.documents.where({ id, libraryId }), {
				tier: ReadTier.LocalFirstUnlessEmpty
			})

			return row !== null
		},
		hasIntent: async (id: string) => {
			const row = await db.one(app.storageOperations.where({ id, libraryId }), {
				tier: ReadTier.LocalFirstUnlessEmpty
			})

			return row !== null
		},
		subscribe: (
			next: (rows: import('../../contracts/storage.js').DocumentHeader[]) => void,
			error: () => void
		) =>
			db.subscribe(
				app.documents.where({ libraryId }),
				{
					onUpdate: (rows) => {
						next(rows)
					},
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			)
	}
}

export type LibraryRecords = ReturnType<typeof createLibraryRecords>
