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
export function createArticleRecords<S extends Snapshot<SaveResult>>(
	db: Pick<Db, 'one' | 'beginTransaction' | 'subscribe'>,
	libraryId: string,
	isCurrent: () => boolean,
	content: ActorLogic<S, { type: 'SHUTDOWN' }, SaveRequest>
) {
	const check = () => {
		if (!isCurrent()) throw new Error('Article scope expired')
	}
	const read = async (id: string) => {
		check()
		const row = await db.one(app.articles.where({ id: uuid(id), libraryId }), {
			tier: ReadTier.LocalFirst
		})
		check()
		return row ? articleRecord(row, libraryId) : null
	}
	const document = async (id: string) => {
		check()
		const row = await db.one(app.documents.where({ id: uuid(id), libraryId }), {
			tier: ReadTier.LocalFirst
		})
		check()
		return row
	}
	const intent = async (id: string) => {
		check()
		const row = await db.one(app.storageOperations.where({ id: uuid(id), libraryId }), {
			tier: ReadTier.LocalFirst
		})
		check()
		return row !== null
	}
	function stage(mode: 'ensure' | 'attach') {
		return createWorkspaceCreationTransaction<
			ArticleDraft,
			Resource,
			{ article: Article | null; available: boolean },
			SyncReceipt,
			WriteHandle
		>({
			...transactionLifecycle(db, check),
			readLocal: async (r, a) => {
				check()
				const row = await r.tx.one(app.articles.where({ id: a.draft.article.id, libraryId }), {
					tier: ReadTier.LocalFirst
				})
				r.article = row
				const available =
					mode === 'attach' &&
					(await r.tx.one(app.documents.where({ id: a.draft.target, libraryId }), {
						tier: ReadTier.LocalFirst
					})) !== null
				check()
				return { article: row, available }
			},
			assess: (rows) =>
				(mode === 'ensure' ? !rows.article : !rows.article?.contentId && rows.available)
					? { outcome: 'eligible' }
					: { outcome: 'blocked', reason: 'Article already exists or is unavailable' },
			stage: (r, a) => {
				check()
				const { id, ...row } = articleRecord(a.draft.article, libraryId)
				if (mode === 'attach') {
					const values = { contentId: a.draft.target, failure: null }
					if (r.article) r.tx.update(app.articles, id, values)
					else r.tx.insert(app.articles, { ...row, ...values }, { id })
				} else r.tx.insert(app.articles, row, { id })
				return transactionReceipt(r)
			}
		})
	}
	const failure = createWorkspaceCreationTransaction<
		{ id: string; code: string | null },
		Resource,
		Article | null,
		SyncReceipt,
		WriteHandle
	>({
		...transactionLifecycle(db, check),
		readLocal: async (r, a) => {
			check()
			const row = await r.tx.one(app.articles.where({ id: uuid(a.draft.id), libraryId }), {
				tier: ReadTier.LocalFirst
			})
			check()
			return row
		},
		assess: (row) =>
			row && row.contentId === null
				? { outcome: 'eligible' }
				: { outcome: 'blocked', reason: 'Article is complete or unavailable' },
		stage: (r, a) => {
			check()
			if (a.draft.code !== null && a.draft.code.length > 100)
				throw new Error('Invalid article failure')
			r.tx.update(app.articles, a.draft.id, { failure: a.draft.code })
			return transactionReceipt(r)
		}
	})
	return {
		libraryId,
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
			ensure: stage('ensure'),
			attach: stage('attach'),
			content
		}),
		subscribePending: (next: (rows: Article[]) => void, error: () => void) =>
			db.subscribe(
				app.articles.where({ libraryId, contentId: null }),
				{
					onUpdate: (rows) => {
						if (isCurrent()) next(rows.map((row) => articleRecord(row, libraryId)))
					},
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			),
		subscribe: (next: (rows: LibraryArticle[]) => void, error: () => void) => {
			let articles: Article[] = []
			let documents: import('../../contracts/storage.js').DocumentHeader[] = []
			const publish = () => {
				if (!isCurrent()) return
				const docs = new Map(documents.map((d) => [d.id, d]))
				const output = new Map<string, LibraryArticle>()
				for (const a of [...articles].sort(
					(a, b) => a.originalSavedAt.localeCompare(b.originalSavedAt) || a.id.localeCompare(b.id)
				)) {
					const d = a.contentId ? docs.get(a.contentId) : undefined
					const key = a.contentId ?? a.id
					if (!output.has(key))
						output.set(key, {
							id: a.id,
							title: d?.title ?? a.url,
							url: a.url,
							contentId: a.contentId,
							originalSavedAt: a.originalSavedAt,
							failure: a.failure
						})
					if (a.contentId) docs.delete(a.contentId)
				}
				for (const d of docs.values())
					if (!output.has(d.id))
						output.set(d.id, {
							id: d.id,
							title: d.title,
							url: null,
							contentId: d.id,
							originalSavedAt: d.originalSavedAt,
							failure: null
						})
				next(
					[...output.values()].sort(
						(a, b) => b.originalSavedAt.localeCompare(a.originalSavedAt) || a.id.localeCompare(b.id)
					)
				)
			}
			const a = db.subscribe(
				app.articles.where({ libraryId }),
				{
					onUpdate: (rows) => {
						articles = rows.map((row) => articleRecord(row, libraryId))
						publish()
					},
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			)
			const d = db.subscribe(
				app.documents.where({ libraryId }),
				{
					onUpdate: (rows) => {
						documents = rows
						publish()
					},
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			)
			return () => {
				a()
				d()
			}
		}
	}
}
