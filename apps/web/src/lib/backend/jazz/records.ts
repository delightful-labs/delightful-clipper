import { createImageRecords } from './images.js'
import { createNoteRecords } from './notes.js'
import {
	createContentIntentDomain,
	createContentPublicationDomain
} from '../../machines/storage/content-domains.js'
import { createDomainTransaction, required } from '../../machines/storage/domain-transaction.js'
import type { ContentFacts } from '../../capture/content-policy.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import type { TransactionResource } from './transaction.js'
import type { ReadCapabilities } from '../../contracts/storage.js'
import { ReadTier } from 'jazz-tools'
import type { Db } from 'jazz-tools'
import type { PreparedSave } from '../../contracts/storage.js'
import { createSaveRecordMachine } from '../../machines/storage/save.js'
import { prepareSave } from '../../storage/prepare.js'
import { app } from './schema.js'
import { insertPreparedContent } from './content.js'
import { createReaderRecords } from './reader.js'
import { createFakeDataRecords } from './fake-data.js'
import { createArticleRecords } from './articles.js'
import type { SearchDocument } from '../../search/schema.js'
import type { LibraryArticle } from '../../contracts/articles.js'

/** Reads stay bound to this DB/library; owning actors gate admission and late-result consumption.
 * Native write admission and commit scope protection live in transactionLifecycle. */
export function createLibraryRecords(
	db: Pick<Db, 'one' | 'all' | 'beginTransaction' | 'beginSerializableTransaction' | 'subscribe'>,
	libraryId: string,
	isCurrent: () => boolean
) {
	const readLocal = async (
		resource: TransactionResource,
		draft: PreparedSave,
		operationId: string
	): Promise<ContentFacts> => {
		const intent = await resource.tx.one(
			app.storageOperations.where({ id: operationId, libraryId }),
			{ tier: ReadTier.LocalFirst }
		)
		const article = draft.articleId
			? await resource.tx.one(app.articles.where({ id: draft.articleId, libraryId }), {
					tier: ReadTier.LocalFirst
				})
			: null
		return { draft, operationId, intent, article }
	}
	const lifecycle = transactionLifecycle(db, isCurrent)
	const intent = createDomainTransaction<PreparedSave>(
		createContentIntentDomain({
			read: readLocal,
			insertIntent: (resource, { draft }) => {
				const { id, ...intent } = draft.intent
				resource.tx.insert(app.storageOperations, intent, { id })
			},
			bindArticle: (resource, { draft }) => {
				resource.tx.update(app.articles, required(draft.articleId), {
					operationId: draft.intent.id,
					failure: null
				})
			},
			createArticle: (resource, { draft }) => {
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
			receipt: transactionReceipt
		}),
		lifecycle
	)
	const publish = createDomainTransaction<PreparedSave>(
		createContentPublicationDomain({
			read: readLocal,
			publishContent: (resource, { draft }) => insertPreparedContent(resource.tx, draft),
			attachContent: (resource, { draft }) => {
				resource.tx.update(app.articles, required(draft.articleId), {
					contentId: draft.document.id,
					failure: null
				})
			},
			publishSource: (resource, { draft }) => {
				const { id, ...source } = required(draft.source)
				resource.tx.insert(app.articleSources, source, { id })
			},
			receipt: transactionReceipt
		}),
		lifecycle
	)

	const records = {
		binding: Object.freeze({}),
		saveMachine: createSaveRecordMachine({
			isCurrent,
			prepare: (request) => prepareSave(libraryId, request),
			intent: (spawn, input) => spawn(intent, { input }),
			publish: (spawn, input) => spawn(publish, { input })
		}),
		readCapabilities: {
			isCurrent,
			document: async (id) => {
				const article = await db.one(app.articles.where({ id, libraryId }), {
					tier: ReadTier.LocalFirst
				})
				const row = await db.one(app.documents.where({ id: article?.contentId ?? id, libraryId }), {
					tier: ReadTier.LocalFirst,
					firstLoadRemoteWaitMs: 5_000
				})

				return row && article ? { ...row, id: article.id } : row
			},
			snapshot: async (id) => {
				const row = await db.one(app.snapshots.where({ id, libraryId }), {
					tier: ReadTier.LocalFirst,
					firstLoadRemoteWaitMs: 5_000
				})

				return row
			},
			asset: async (id) => {
				const row = await db.one(app.assets.where({ id, libraryId }), {
					tier: ReadTier.LocalFirst,
					firstLoadRemoteWaitMs: 5_000
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
		reader: createReaderRecords(db, libraryId, isCurrent),
		notes: createNoteRecords(db, libraryId, isCurrent),
		images: createImageRecords(db, libraryId, isCurrent),
		fakeData: createFakeDataRecords(db, libraryId, isCurrent),
		searchDocuments: async (
			rows: LibraryArticle[],
			signal: AbortSignal
		): Promise<SearchDocument[]> => {
			signal.throwIfAborted()
			const [documents, snapshots] = await Promise.allSettled([
				db.all(app.documents.where({ libraryId }), { tier: ReadTier.LocalFirst }),
				db.all(app.snapshots.where({ libraryId }), { tier: ReadTier.LocalFirst })
			])
			signal.throwIfAborted()
			if (documents.status === 'rejected') throw documents.reason
			if (snapshots.status === 'rejected') throw snapshots.reason
			const docs = new Map(documents.value.map((document) => [document.id, document]))
			const texts = new Map(snapshots.value.map((snapshot) => [snapshot.id, snapshot.text]))
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
		articles: createArticleRecords(db, libraryId, isCurrent, (spawn, input) =>
			spawn(records.saveMachine, { input })
		),
		isCurrent,
		hasDocument: async (id: string) => {
			const row = await db.one(app.documents.where({ id, libraryId }), {
				tier: ReadTier.LocalFirst,
				firstLoadRemoteWaitMs: 5_000
			})

			return row !== null
		},
		hasIntent: async (id: string) => {
			const row = await db.one(app.storageOperations.where({ id, libraryId }), {
				tier: ReadTier.LocalFirst,
				firstLoadRemoteWaitMs: 5_000
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
