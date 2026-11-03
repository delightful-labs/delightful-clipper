import type { ReadCapabilities } from '../../contracts/storage.js'
import { ReadTier } from 'jazz-tools'
import type { Db, Transaction, WriteHandle } from 'jazz-tools'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import type { PreparedSave, StorageIntent, SyncReceipt } from '../../contracts/storage.js'
import { createSaveRecordMachine } from '../../machines/storage/save.js'
import { prepareSave } from '../../storage/prepare.js'
import { app } from './schema.js'
import { createIntakeRecords } from './intakes.js'

type Resource = { transaction: Transaction<'mergeable'>; write: WriteHandle | undefined }
type Stage = 'intent' | 'publish'
export function createLibraryRecords(
	db: Pick<Db, 'one' | 'beginTransaction' | 'subscribe'>,
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
					if (draft.source) {
						const { id: sourceId, ...source } = draft.source
						resource.transaction.insert(app.articleSources, source, { id: sourceId })
					}
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
	const records = {
		intakes: createIntakeRecords(db, libraryId, isCurrent),
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
		readCapabilities: {
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
			},
			source: async (id, signal) => {
				check()
				signal.throwIfAborted()
				const row = await db.one(app.articleSources.where({ id, libraryId }), {
					tier: ReadTier.LocalFirst
				})
				check()
				signal.throwIfAborted()
				return row
			}
		} satisfies ReadCapabilities
	}
	return {
		...records,
		isCurrent,
		hasDocument: async (id: string) => {
			check()
			const row = await db.one(app.documents.where({ id, libraryId }), {
				tier: ReadTier.LocalFirstUnlessEmpty
			})
			check()
			return row !== null
		},
		hasIntent: async (id: string) => {
			check()
			const row = await db.one(app.storageOperations.where({ id, libraryId }), {
				tier: ReadTier.LocalFirstUnlessEmpty
			})
			check()
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
						if (isCurrent()) next(rows)
					},
					onError: error
				},
				{ tier: ReadTier.LocalFirst }
			)
	}
}

export type LibraryRecords = ReturnType<typeof createLibraryRecords>
