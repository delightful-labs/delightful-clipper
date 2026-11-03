import { ReadTier } from 'jazz-tools'
import type { Db, Transaction, WriteHandle } from 'jazz-tools'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import {
	decodeCompletion,
	captureUuid,
	decodeIntake,
	decodeObservation,
	encodeObservation
} from '../../capture/intake.js'
import type {
	CaptureCompletion,
	CaptureIntake,
	CaptureObservation
} from '../../contracts/intake.js'
import type { SyncReceipt } from '../../contracts/storage.js'
import { app } from './schema.js'

type Resource = { transaction: Transaction<'mergeable'>; write?: WriteHandle }
/** Leaves only. Recover existing operations by reading, never by replaying this insert. */
export function createIntakeRecords(
	db: Pick<Db, 'one' | 'beginTransaction'>,
	libraryId: string,
	isCurrent: () => boolean
) {
	function check() {
		if (!isCurrent()) throw new Error('Capture scope expired')
	}
	function immutableStage<Draft extends { id: string }>(
		validate: (value: Draft) => Draft,
		read: (tx: Transaction<'mergeable'>, id: string) => Promise<unknown>,
		insert: (tx: Transaction<'mergeable'>, row: Draft) => void
	) {
		return createWorkspaceCreationTransaction<Draft, Resource, boolean, SyncReceipt, WriteHandle>({
			open: () => {
				check()
				return { transaction: db.beginTransaction() }
			},
			readLocal: async (resource, attempt) => {
				check()
				const draft = validate(attempt.draft)
				if (
					attempt.operationId !== draft.id ||
					attempt.workspaceId !== draft.id ||
					attempt.membershipId !== draft.id
				)
					throw new Error('Capture operation mismatch')
				const row = await read(resource.transaction, draft.id)
				check()
				return row !== null
			},
			assess: (exists) =>
				exists
					? { outcome: 'blocked', reason: 'Capture identity already exists' }
					: { outcome: 'eligible' },
			stage: (resource, attempt) => {
				check()
				insert(resource.transaction, validate(attempt.draft))
				return {
					global: () => {
						if (!resource.write) throw new Error('Missing capture receipt')
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
		libraryId,
		read: async (id: string): Promise<CaptureIntake | null> => {
			check()
			const row = await db.one(app.captureIntakes.where({ id: captureUuid(id), libraryId }), {
				tier: ReadTier.LocalFirst
			})
			check()
			return row === null ? null : decodeIntake(row, libraryId)
		},
		insert: immutableStage<CaptureIntake>(
			(row) => decodeIntake(row, libraryId),
			(tx, id) =>
				tx.one(app.captureIntakes.where({ id: captureUuid(id), libraryId }), {
					tier: ReadTier.LocalFirst
				}),
			(tx, { id, ...row }) => {
				tx.insert(app.captureIntakes, row, { id })
			}
		),
		observe: immutableStage<CaptureObservation>(
			(row) => decodeObservation(encodeObservation(row, libraryId), libraryId),
			(tx, id) =>
				tx.one(app.captureObservations.where({ id: captureUuid(id), libraryId }), {
					tier: ReadTier.LocalFirst
				}),
			(tx, value) => {
				const { id, ...row } = encodeObservation(value, libraryId)
				tx.insert(app.captureObservations, row, { id })
			}
		),
		complete: immutableStage<CaptureCompletion>(
			(row) => decodeCompletion(row, libraryId),
			(tx, id) =>
				tx.one(app.captureCompletions.where({ id: captureUuid(id), libraryId }), {
					tier: ReadTier.LocalFirst
				}),
			(tx, { id, ...row }) => {
				tx.insert(app.captureCompletions, row, { id })
			}
		),
		readObservation: async (id: string): Promise<CaptureObservation | null> => {
			check()
			const row = await db.one(app.captureObservations.where({ id: captureUuid(id), libraryId }), {
				tier: ReadTier.LocalFirst
			})
			check()
			return row === null ? null : decodeObservation(row, libraryId)
		},
		readCompletion: async (id: string): Promise<CaptureCompletion | null> => {
			check()
			const row = await db.one(app.captureCompletions.where({ id: captureUuid(id), libraryId }), {
				tier: ReadTier.LocalFirst
			})
			check()
			return row === null ? null : decodeCompletion(row, libraryId)
		}
	}
}
