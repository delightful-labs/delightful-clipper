import { z } from 'zod'
import { tagOperationSchema, tagRequestSchema, tagKey } from '../../capture/tags.js'
import type { TagOperation } from '../../capture/tags.js'
import { createOrganizationDomain } from '../../machines/storage/organization-domain.js'
import type { OrganizationFacts } from '../../machines/storage/organization-domain.js'
import { createDomainTransaction } from '../../machines/storage/domain-transaction.js'
import { ReadTier } from 'jazz-tools'
import type { Db } from 'jazz-tools'
import {
	organizationOperationSchema,
	organizationHeads,
	organizationTargets,
	organizationRequestSchema
} from '../../capture/organization.js'
import type { OrganizationOperation } from '../../capture/organization.js'
import {
	createOrganizationMachine,
	type OrganizationDraft
} from '../../machines/storage/organize.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import type { TransactionResource } from './transaction.js'
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
	const readLocal = async (
		resource: TransactionResource,
		input: OrganizationDraft,
		operationId: string
	): Promise<OrganizationFacts> => {
		const request = organizationRequestSchema.parse(input)
		const draft = { ...request, operations: input.operations }
		const article = await resource.tx.one(app.articles.where({ id: request.id, libraryId }), {
			tier: ReadTier.LocalFirst
		})
		const document = await resource.tx.one(app.documents.where({ id: request.id, libraryId }), {
			tier: ReadTier.LocalFirst
		})
		const aliases = await resource.tx.all(
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
		const parents = organizationHeads(
			draft.operations.filter((row) => targets.has(row.articleId))
		).map((row) => row.id)
		return { draft, operationId, article, document, parents }
	}
	const insertTag =
		(reference: 'articleId' | 'documentId') =>
		(resource: TransactionResource, facts: OrganizationFacts) => {
			resource.tx.insert(
				app.tagOperations,
				{
					articleId: null,
					documentId: null,
					[reference]: facts.draft.id,
					...tagAssignmentValues(facts.draft, libraryId, facts.parents)
				},
				{ id: facts.operationId }
			)
		}
	const insertOrganization =
		(reference: 'articleId' | 'documentId') =>
		(resource: TransactionResource, facts: OrganizationFacts) => {
			resource.tx.insert(
				app.organizationOperations,
				{
					libraryId,
					field: facts.draft.field,
					value: String(facts.draft.value),
					parents: JSON.stringify(facts.parents),
					articleId: null,
					documentId: null,
					[reference]: facts.draft.id
				},
				{ id: facts.operationId }
			)
		}
	const stage = createDomainTransaction<OrganizationDraft>(
		createOrganizationDomain({
			read: readLocal,
			insertArticle: insertOrganization('articleId'),
			insertDocument: insertOrganization('documentId'),
			insertTagArticle: insertTag('articleId'),
			insertTagDocument: insertTag('documentId'),
			receipt: transactionReceipt
		}),
		transactionLifecycle(db, isCurrent)
	)

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
