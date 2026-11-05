import { z } from 'zod'
import { tagOperationSchema, tagRequestSchema, tagKey } from '../../capture/tags.js'
import type { TagOperation } from '../../capture/tags.js'
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
const tagHistorySchema = z.array(tagOperationSchema)
const organizationHistorySchema = z.array(organizationOperationSchema)
/** Data projection only: observed spelling is reused without renaming the shared tag. */
function tagAssignmentValues(draft: OrganizationDraft, libraryId: string, parents: string[]) {
	const request = tagRequestSchema.parse(draft)
	const known = draft.operations
		.filter((operation) => operation.field === 'tag')
		.sort((a, b) => a.id.localeCompare(b.id))[0]
	return {
		libraryId,
		parents: JSON.stringify(parents),
		key: tagKey(request.value),
		name: known?.name ?? request.value,
		assigned: request.assigned
	}
}
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
			const parents = r.parents
			const values = {
				libraryId,
				field: a.draft.field,
				value: String(a.draft.value),
				parents: JSON.stringify(r.parents)
			}
			const insertTag = (reference: 'articleId' | 'documentId') =>
				r.tx.insert(
					app.tagOperations,
					{
						articleId: null,
						documentId: null,
						[reference]: a.draft.id,
						...tagAssignmentValues(a.draft, libraryId, parents)
					},
					{ id: a.operationId }
				)
			return stageOrganization({
				hasArticle: !!r.article,
				tagAssignment: a.draft.field === 'tag',
				insertTagArticle: () => insertTag('articleId'),
				insertTagDocument: () => insertTag('documentId'),
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
		machine: createOrganizationMachine(
			stage,
			isCurrent,
			async (request) => {
				const rows = await db.all(
					app.organizationOperations.where({ libraryId, field: request.field }),
					{ tier: ReadTier.LocalFirst }
				)
				return organizationHistorySchema.parse(rows)
			},
			async (request) => {
				const tag = tagRequestSchema.parse(request)
				const rows = await db.all(app.tagOperations.where({ libraryId, key: tagKey(tag.value) }), {
					tier: ReadTier.LocalFirst
				})
				return tagHistorySchema.parse(rows)
			}
		),
		subscribeTags: (next: (rows: TagOperation[]) => void, error: () => void) =>
			db.subscribe(
				app.tagOperations.where({ libraryId }),
				{
					onUpdate: (rows) => {
						const parsed = tagHistorySchema.safeParse(rows)
						if (!parsed.success) {
							error()
							return
						}
						next(parsed.data)
					},
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			),
		subscribe: (next: (rows: OrganizationOperation[]) => void, error: () => void) =>
			db.subscribe(
				app.organizationOperations.where({ libraryId }),
				{
					onUpdate: (rows) => {
						const parsed = organizationHistorySchema.safeParse(rows)
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
