import { ReadTier } from 'jazz-tools'
import type { Db, Transaction, WriteHandle } from 'jazz-tools'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import type { PreparedSave, StorageIntent, SyncReceipt } from '../../contracts/storage.js'
import { createSaveRecordMachine } from '../../machines/storage/save.js'
import { createReadRecordMachine } from '../../machines/storage/read.js'
import { prepareSave } from '../../storage/prepare.js'
import { app } from './schema.js'

type Resource = { transaction: Transaction<'mergeable'>; write: WriteHandle | undefined }
type Stage = 'intent' | 'publish'
export function createLibraryRecords(
	db: Pick<Db, 'one' | 'beginTransaction'>,
	libraryId: string,
	isCurrent: () => boolean
) {
	const check = () => {
		if (!isCurrent()) throw new Error('Library scope expired')
	}
	function stageLogic(stage: Stage) {
		return createWorkspaceCreationTransaction<
			PreparedSave,
			Resource,
			StorageIntent | null,
			SyncReceipt,
			WriteHandle
		>({
			open: () => {
				check()
				return { transaction: db.beginTransaction(), write: undefined }
			},
			readLocal: async (resource, attempt) => {
				check()
				const row = await resource.transaction.one(
					app.storageOperations.where({ id: attempt.operationId, libraryId }),
					{ tier: ReadTier.LocalFirst }
				)
				check()
				return row
			},
			assess: (row, attempt) => ({
				outcome: (
					stage === 'intent' ? row === null : row?.payloadHash === attempt.draft.intent.payloadHash
				)
					? 'eligible'
					: 'blocked',
				reason: 'Operation identity is not eligible'
			}),
			stage: (resource, attempt) => {
				check()
				const { draft } = attempt
				if (stage === 'intent') {
					const { id, ...intent } = draft.intent
					resource.transaction.insert(app.storageOperations, intent, { id })
				}

				if (stage === 'publish') {
					const { id: assetId, ...asset } = draft.asset
					resource.transaction.insert(app.assets, asset, { id: assetId })
					const { id: snapshotId, ...snapshot } = draft.snapshot
					resource.transaction.insert(app.snapshots, snapshot, { id: snapshotId })
					const { id, ...document } = draft.document
					resource.transaction.insert(app.documents, document, { id })
				}
				return {
					global: () => {
						if (!resource.write) throw new Error('Missing committed receipt')
						return resource.write.wait({ tier: 'global' })
					}
				}
			},
			commit: (resource) => {
				check()
				const write = resource.transaction.commit()
				resource.write = write
				return write
			},
			persistLocal: (write) => write.wait({ tier: 'local' }),
			rollback: (resource) => resource.transaction.rollback()
		})
	}
	return {
		binding: Object.freeze({}),
		saveMachine: createSaveRecordMachine({
			isCurrent,
			prepare: (request) => {
				check()
				return prepareSave(libraryId, request)
			},
			intent: stageLogic('intent'),
			publish: stageLogic('publish')
		}),
		readMachine: createReadRecordMachine({
			isCurrent,
			document: async (id) => {
				check()
				const row = await db.one(app.documents.where({ id, libraryId }), {
					tier: ReadTier.LocalFirstUnlessEmpty
				})
				check()
				return row
			},
			snapshot: async (id) => {
				check()
				const row = await db.one(app.snapshots.where({ id, libraryId }), {
					tier: ReadTier.LocalFirstUnlessEmpty
				})
				check()
				return row
			},
			asset: async (id) => {
				check()
				const row = await db.one(app.assets.where({ id, libraryId }), {
					tier: ReadTier.LocalFirstUnlessEmpty
				})
				check()
				return row
			}
		})
	}
}
