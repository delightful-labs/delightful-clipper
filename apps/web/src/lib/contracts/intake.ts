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
	read: (id: string) => Promise<CaptureIntake | null>
	insert: AdmissionStage<S>
}
/** Recovery is read-only. A missing row never authorizes another insert. */
export type AdmissionInput =
	| { kind: 'new'; intake: CaptureIntake }
	| { kind: 'recover'; intakeId: string }
export type AdmissionResult =
	| {
			kind: 'admitted'
			intakeId: string
			receipts: [SyncReceipt]
	  }
	/** Visible Jazz data, without a recovered local/global write receipt. */
	| { kind: 'recovered'; intake: CaptureIntake }
	| { kind: 'failed' | 'uncertain' | 'blocked' | 'interrupted' | 'scopeChanged'; intakeId: string }
