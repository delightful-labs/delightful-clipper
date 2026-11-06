import type { ActorLogic, ActorRef, Snapshot } from 'xstate'
import type { WorkspaceCreationResult } from 'delightful-local-first/workspace/creation/contracts'
import type { ReaderChange, ReaderOperation } from '../reader/schema.js'
import type { SyncReceipt } from './storage.js'
export type ReaderStageResult = WorkspaceCreationResult<ReaderChange, SyncReceipt>
export type ReaderStage<S extends Snapshot<ReaderStageResult> = Snapshot<ReaderStageResult>> =
	ActorLogic<
		S,
		{ type: 'SHUTDOWN' | 'CANCEL' },
		{
			attempt: {
				operationId: string
				workspaceId: string
				membershipId: string
				draft: ReaderChange
			}
		}
	>
export type ReaderStageRef = ActorRef<Snapshot<ReaderStageResult>, { type: 'SHUTDOWN' | 'CANCEL' }>
export type ReaderStageSpawner = <S extends Snapshot<ReaderStageResult>>(
	logic: ReaderStage<S>,
	options: {
		input: {
			attempt: {
				operationId: string
				workspaceId: string
				membershipId: string
				draft: ReaderChange
			}
		}
	}
) => ActorRef<S, { type: 'SHUTDOWN' | 'CANCEL' }>
export type ReaderCapability = {
	isCurrent: () => boolean
	subscribe: (next: (rows: ReaderOperation[]) => void, error: () => void) => () => void
	spawnWrite: (
		spawn: ReaderStageSpawner,
		change: ReaderChange,
		operationId: string,
		observed: ReaderOperation[]
	) => ReaderStageRef
}
