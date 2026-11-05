import { stageOrganization } from '../../machines/storage/mutations.js'
import { ReadTier } from 'jazz-tools'
import type { Db, WriteHandle } from 'jazz-tools'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import {
	organizationOperationSchema,
	organizationHeads,
	organizationTargets,
	organizationRequestSchema,
	canOrganizeArticle
} from '../../capture/organization.js'
import type { OrganizationOperation } from '../../capture/organization.js'
import {
	createOrganizationMachine,
	type OrganizationDraft
} from '../../machines/storage/organize.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import type { TransactionResource } from './transaction.js'
import type { SyncReceipt } from '../../contracts/storage.js'
import { app } from './schema.js'
export function createOrganizationRecords(
	db: Pick<Db, 'one' | 'all' | 'beginTransaction' | 'subscribe'>,
	libraryId: string,
	isCurrent: () => boolean
) {
	type Resource = TransactionResource & { parents?: string[] }
	const stage = createWorkspaceCreationTransaction<
		OrganizationDraft,
		Resource,
		{ article: unknown; document: unknown },
		SyncReceipt,
		WriteHandle
	>({
		...transactionLifecycle(db, isCurrent),
		readLocal: async (r, a) => {
			const request = organizationRequestSchema.parse(a.draft)
			const article = await r.tx.one(app.articles.where({ id: request.id, libraryId }), {
				tier: ReadTier.LocalFirst
			})
			r.article = article
			const document = await r.tx.one(app.documents.where({ id: request.id, libraryId }), {
				tier: ReadTier.LocalFirst
			})
			const aliases = await r.tx.all(
				app.articles.where({
					libraryId,
					contentId: article?.contentId ?? document?.id ?? request.id
				}),
				{ tier: ReadTier.LocalFirst }
			)
			const targets = organizationTargets(
				request.id,
				article?.contentId ?? document?.id ?? null,
				aliases
			)
			r.parents = organizationHeads(
				a.draft.operations.filter((row) => targets.has(row.articleId))
			).map((row) => row.id)
			return { article, document }
		},
		assess: (rows) =>
			canOrganizeArticle(rows.article, rows.document)
				? { outcome: 'eligible' }
				: { outcome: 'blocked', reason: 'Article unavailable' },
		stage: (r, a) => {
			if (!r.parents) throw new Error('Missing organization observation')
			const values = {
				libraryId,
				field: a.draft.field,
				value: String(a.draft.value),
				parents: JSON.stringify(r.parents)
			}
			return stageOrganization({
				hasArticle: !!r.article,
				insertArticle: () => {
					r.tx.insert(
						app.organizationOperations,
						{ ...values, articleId: a.draft.id, documentId: null },
						{ id: a.operationId }
					)
				},
				insertDocument: () => {
					r.tx.insert(
						app.organizationOperations,
						{ ...values, articleId: null, documentId: a.draft.id },
						{ id: a.operationId }
					)
				},
				receipt: () => transactionReceipt(r)
			})
		}
	})
	return {
		machine: createOrganizationMachine(stage, isCurrent, async (request) => {
			const rows = await db.all(
				app.organizationOperations.where({ libraryId, field: request.field }),
				{ tier: ReadTier.LocalFirst }
			)
			return rows.map((row) => organizationOperationSchema.parse(row))
		}),
		subscribe: (next: (rows: OrganizationOperation[]) => void, error: () => void) =>
			db.subscribe(
				app.organizationOperations.where({ libraryId }),
				{
					onUpdate: (rows) => {
						const parsed = rows.map((row) => organizationOperationSchema.safeParse(row))
						if (parsed.some((row) => !row.success)) {
							error()
							return
						}
						next(parsed.flatMap((row) => (row.success ? [row.data] : [])))
					},
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			)
	}
}
