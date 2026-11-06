import { ReadTier } from 'jazz-tools'
import type { Db, WriteHandle } from 'jazz-tools'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { app } from './schema.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import type { TransactionResource } from './transaction.js'
import type { SyncReceipt } from '../../contracts/storage.js'
import {
	articleNoteRevisionSchema,
	storedArticleNoteHistorySchema,
	storedArticleNoteRevisionSchema,
	sameArticleNoteRevision
} from '../../notes/schema.js'
import type { ArticleNoteRevision } from '../../notes/schema.js'
import { articleTargets } from '../../capture/causal.js'
import { stageNoteParent } from '../../machines/storage/note-parent.js'

type NoteAdmission = {
	library: unknown
	parent: unknown
	validParents: boolean
	unusedOperation: boolean
}
export function canWriteArticleNote(rows: NoteAdmission) {
	return !!rows.library && !!rows.parent && rows.validParents && rows.unusedOperation
}

/** Immutable revisions are issued once. Unknown outcomes are reconciled by readRevision,
 * never by inserting the same operation again or recomputing its causal parents. */
export function createNoteRecords(
	db: Pick<Db, 'one' | 'all' | 'beginTransaction' | 'subscribe'>,
	libraryId: string,
	isCurrent: () => boolean
) {
	type Resource = TransactionResource & { noteDocument?: unknown }
	const stage = createWorkspaceCreationTransaction<
		ArticleNoteRevision,
		Resource,
		NoteAdmission,
		SyncReceipt,
		WriteHandle
	>({
		...transactionLifecycle(db, isCurrent),
		readLocal: async (resource, attempt) => {
			const revision = articleNoteRevisionSchema.parse(attempt.draft)
			if (revision.libraryId !== libraryId || revision.id !== attempt.operationId)
				throw new Error('Invalid note scope')
			const tx = resource.tx
			const library = await tx.one(app.libraries.where({ id: libraryId }), {
				tier: ReadTier.LocalFirst
			})
			const article = await tx.one(app.articles.where({ id: revision.articleId, libraryId }), {
				tier: ReadTier.LocalFirst
			})
			const document = await tx.one(app.documents.where({ id: revision.articleId, libraryId }), {
				tier: ReadTier.LocalFirst
			})
			resource.article = article
			resource.noteDocument = document
			const aliases = await tx.all(
				app.articles.where({ libraryId, contentId: article?.contentId ?? revision.articleId }),
				{ tier: ReadTier.LocalFirst }
			)
			const targets = articleTargets(
				revision.articleId,
				article?.contentId ?? document?.id ?? null,
				aliases
			)
			const rows = storedArticleNoteHistorySchema.parse(
				await tx.all(app.articleNoteRevisions.where({ libraryId }), { tier: ReadTier.LocalFirst })
			)
			const observed = new Map(rows.map((row) => [row.id, row]))
			return {
				library,
				parent: article ?? document,
				unusedOperation: !observed.has(revision.id),
				validParents: revision.parents.every((id) => {
					const parent = observed.get(id)
					return (
						parent !== undefined && parent.libraryId === libraryId && targets.has(parent.articleId)
					)
				})
			}
		},
		assess: (rows) =>
			canWriteArticleNote(rows)
				? { outcome: 'eligible' }
				: { outcome: 'blocked', reason: 'Note parent or operation unavailable' },
		stage: (resource, attempt) => {
			const { id, ...revision } = articleNoteRevisionSchema.parse(attempt.draft)
			const values = { ...revision, parents: JSON.stringify(revision.parents) }
			return stageNoteParent({
				article: resource.article,
				document: resource.noteDocument,
				insertArticle: () =>
					resource.tx.insert(
						app.articleNoteRevisions,
						{
							...values,
							articleParentId: revision.articleId,
							documentParentId: null
						},
						{ id }
					),
				insertDocument: () =>
					resource.tx.insert(
						app.articleNoteRevisions,
						{
							...values,
							articleParentId: null,
							documentParentId: revision.articleId
						},
						{ id }
					),
				receipt: () => transactionReceipt(resource)
			})
		}
	})
	return {
		stage,
		isCurrent,
		libraryId,
		readRevision: async (revision: ArticleNoteRevision) => {
			const row = await db.one(app.articleNoteRevisions.where({ id: revision.id, libraryId }), {
				tier: ReadTier.LocalFirst
			})
			if (!row) return null
			const parsed = storedArticleNoteRevisionSchema.parse(row)
			if (!sameArticleNoteRevision(parsed, revision)) throw new Error('Invalid note operation')
			return parsed
		},
		targets: async (id: string) => {
			const article = await db.one(app.articles.where({ id, libraryId }), {
				tier: ReadTier.LocalFirst
			})
			const aliases = await db.all(
				app.articles.where({ libraryId, contentId: article?.contentId ?? id }),
				{
					tier: ReadTier.LocalFirst
				}
			)
			return [...articleTargets(id, article?.contentId ?? id, aliases)]
		},
		subscribe: (next: (rows: ArticleNoteRevision[]) => void, error: () => void) =>
			db.subscribe(
				app.articleNoteRevisions.where({ libraryId }),
				{
					onUpdate: (rows) => {
						const parsed = storedArticleNoteHistorySchema.safeParse(rows)
						if (!parsed.success) {
							error()
							return
						}
						next(parsed.data)
					},
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			)
	}
}
