import type { ActorLogic, Snapshot } from 'xstate'
import type { WorkspaceCreationResult } from 'delightful-local-first/workspace/creation/contracts'
import type { SyncReceipt } from './storage.js'

export type CaptureIntake = {
	id: string
	libraryId: string
	submittedUrl: string
	fetchUrl: string
	createdAt: string
	formatVersion: '1'
}
export type CaptureObservation = {
	id: string
	libraryId: string
	intakeId: string
	attemptId: string
	createdAt: string
	formatVersion: '1'
} & (
	| { kind: 'resolution'; payload: ResolutionEvidence }
	| { kind: 'failure'; payload: { code: CaptureFailureCode; retryable: boolean } }
	| { kind: 'uncertain'; payload: { operationId: string } }
)
export type ResolutionEvidence = {
	finalUrl: string
	resolvedAt: string
	redirects: { from: string; to: string; status: number }[]
}
export type CaptureFailureCode =
	| 'invalidInput'
	| 'permissionDenied'
	| 'sessionUnavailable'
	| 'gatewayUnavailable'
	| 'rateLimited'
	| 'redirectBlocked'
	| 'redirectLoop'
	| 'fetchTimeout'
	| 'sourceUnavailable'
	| 'parseFailed'
	| 'sourceTooLarge'
	| 'unsupportedSource'
	| 'unsupportedMedia'
	| 'invalidResponse'
	| 'networkUnavailable'
	| 'canceled'
export type CaptureCompletion = {
	id: string
	libraryId: string
	intakeId: string
	attemptId: string
	documentId: string
	createdAt: string
	formatVersion: '1'
}
/** Version 1 currently admits only URL intake. Unknown future execution phases fail closed. */
export type IntakeCheckpoint = {
	formatVersion: '1'
	intake: CaptureIntake
	attemptId: string
	revision: number
	phase: 'pending' | 'issuing' | 'admitted'
}
export type IntakeJournal = {
	get: (id: string) => Promise<IntakeCheckpoint | null>
	create: (checkpoint: IntakeCheckpoint) => Promise<boolean>
	advance: (
		previous: IntakeCheckpoint,
		phase: IntakeCheckpoint['phase']
	) => Promise<IntakeCheckpoint | null>
	page: (after?: string, limit?: number) => Promise<IntakeCheckpoint[]>
}
export type AdmissionStageResult = WorkspaceCreationResult<CaptureIntake, SyncReceipt>
export type AdmissionStage<S extends Snapshot<AdmissionStageResult>> = ActorLogic<
	S,
	{ type: 'SHUTDOWN' | 'CANCEL' },
	{
		attempt: {
			operationId: string
			workspaceId: string
			membershipId: string
			draft: CaptureIntake
		}
	}
>
export type AdmissionCapability<S extends Snapshot<AdmissionStageResult>> = {
	libraryId: string
	isCurrent: () => boolean
	journal: IntakeJournal
	read: (id: string) => Promise<CaptureIntake | null>
	insert: AdmissionStage<S>
}
export type AdmissionInput = { intake: CaptureIntake; attemptId: string }
export type AdmissionResult =
	| {
			kind: 'admitted'
			intakeId: string
			/** Empty on recovery: do not submit an empty watch and infer global acceptance. */
			receipts: SyncReceipt[]
	  }
	| { kind: 'failed' | 'uncertain' | 'blocked' | 'interrupted' | 'scopeChanged'; intakeId: string }
