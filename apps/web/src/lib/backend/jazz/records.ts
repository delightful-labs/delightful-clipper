import { ReadTier } from 'jazz-tools'
import type { Db, Transaction, WriteHandle } from 'jazz-tools'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import type { PreparedSave, StorageIntent, SyncReceipt } from '../../contracts/storage.js'
import { createSaveRecordMachine } from '../../machines/storage/save.js'
import { createReadRecordMachine } from '../../machines/storage/read.js'
import { decodeAsset, prepareSave, verifyParts, verifyText } from '../../storage/codec.js'
import { app } from './schema.js'

type Resource = { transaction: Transaction<'mergeable'>; write: WriteHandle | undefined }
type Stage = 'intent' | 'parts' | 'publish'
export function createLibraryRecords(
	db: Pick<Db, 'one' | 'all' | 'beginTransaction'>,
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
					const { id: manifestId, ...manifest } = draft.manifest
					resource.transaction.insert(app.blobManifests, manifest, { id: manifestId })
				}
				if (stage === 'parts')
					for (const part of draft.parts) {
						const { id, ...payload } = part
						resource.transaction.insert(app.blobParts, payload, { id })
					}
				if (stage === 'publish') {
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
	const parts = async (id: string) => {
		check()
		const rows = await db.all(app.blobParts.where({ manifestId: id, libraryId }).limit(6), {
			tier: ReadTier.LocalFirst
		})
		check()
		return rows
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
			parts: stageLogic('parts'),
			publish: stageLogic('publish'),
			readParts: parts,
			verify: async (input) => {
				await verifyParts(input)
				check()
			}
		}),
		readMachine: createReadRecordMachine({
			isCurrent,
			document: async (id) => {
				check()
				const row = await db.one(app.documents.where({ id, libraryId }), {
					tier: ReadTier.LocalFirst
				})
				check()
				return row
			},
			snapshot: async (id) => {
				check()
				const row = await db.one(app.snapshots.where({ id, libraryId }), {
					tier: ReadTier.LocalFirst
				})
				check()
				return row
			},
			manifest: async (id) => {
				check()
				const row = await db.one(app.blobManifests.where({ id, libraryId }), {
					tier: ReadTier.LocalFirst
				})
				check()
				return row
			},
			parts,
			verifyText,
			decode: decodeAsset
		})
	}
}
