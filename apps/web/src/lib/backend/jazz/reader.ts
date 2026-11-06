import { ReadTier } from 'jazz-tools'
import type { Db, WriteHandle } from 'jazz-tools'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import { causalHeads } from '../../capture/causal.js'
import { readerChangeSchema, readerHistorySchema, sameReaderField } from '../../reader/schema.js'
import type { ReaderChange, ReaderOperation } from '../../reader/schema.js'
import type { SyncReceipt } from '../../contracts/storage.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import type { TransactionResource } from './transaction.js'
import { app } from './schema.js'
import type { ReaderCapability, ReaderStageSpawner } from '../../contracts/reader.js'
export function canWriteReaderChange(
	rows: { library: unknown; document: unknown },
	draft: ReaderChange
) {
	return !!rows.library && (draft.documentId === null || !!rows.document)
}
export function createReaderRecords(
	db: Pick<Db, 'one' | 'all' | 'beginTransaction' | 'subscribe'>,
	libraryId: string,
	isCurrent: () => boolean
) {
	type Resource = TransactionResource
	const stage = (observed: ReaderOperation[]) =>
		createWorkspaceCreationTransaction<
			ReaderChange,
			Resource,
			{ library: unknown; document: unknown },
			SyncReceipt,
			WriteHandle
		>({
			...transactionLifecycle(db, isCurrent),
			readLocal: async (resource, attempt) => {
				const change = readerChangeSchema.parse(attempt.draft)
				const library = await resource.tx.one(app.libraries.where({ id: libraryId }), {
					tier: ReadTier.LocalFirst
				})
				const document = await resource.tx.one(
					app.documents.where({ id: change.documentId ?? libraryId, libraryId }),
					{ tier: ReadTier.LocalFirst }
				)
				return { library, document }
			},
			assess: (rows, attempt) =>
				canWriteReaderChange(rows, attempt.draft)
					? { outcome: 'eligible' }
					: { outcome: 'blocked', reason: 'Reading parent unavailable' },
			stage: (resource, attempt) => {
				const change = readerChangeSchema.parse(attempt.draft)
				const parents = causalHeads(observed.filter((row) => sameReaderField(row, change))).map(
					(row) => row.id
				)
				resource.tx.insert(
					app.readerOperations,
					{
						libraryId,
						documentId: change.documentId,
						field: change.field,
						value: JSON.stringify(change.value),
						parents: JSON.stringify(parents)
					},
					{ id: attempt.operationId }
				)
				return transactionReceipt(resource)
			}
		})
	return {
		stage,
		capability: {
			isCurrent,
			spawnWrite: (
				spawn: ReaderStageSpawner,
				change: ReaderChange,
				operationId: string,
				observed: ReaderOperation[]
			) => {
				return spawn(stage(observed), {
					input: {
						attempt: {
							operationId,
							workspaceId: operationId,
							membershipId: operationId,
							draft: change
						}
					}
				})
			},
			subscribe: (next: (rows: ReaderOperation[]) => void, error: () => void) =>
				db.subscribe(
					app.readerOperations.where({ libraryId }),
					{
						onUpdate: (rows) => {
							const parsed = readerHistorySchema.safeParse(rows)
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
		} satisfies ReaderCapability
	}
}
