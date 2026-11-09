import type { ActorInstance, Snapshot } from 'xstate'
import type { WorkspaceCreationResult } from 'delightful-local-first/workspace/creation/contracts'
import type { SyncReceipt, StoredAsset } from './storage.js'
import type {
	ArticleImage,
	ImageWrite,
	ReadyImageWrite,
	FailedImageWrite
} from '../images/schema.js'
export type ImageStageResult = WorkspaceCreationResult<ImageWrite, SyncReceipt>
export type ImageStageRef = ActorInstance<
	Snapshot<ImageStageResult>,
	{ type: 'SHUTDOWN' | 'CANCEL' }
>
export type ImageSpawner = import('../machines/children.js').ChildSpawner
export type ImageCapability = {
	isCurrent: () => boolean
	hasIntent: (id: string, signal: AbortSignal) => Promise<boolean>
	subscribe: (next: (rows: ArticleImage[]) => void, error: () => void) => () => void
	subscribeImage: (
		documentId: string,
		sourceUrl: string,
		next: (rows: ArticleImage[]) => void,
		error: () => void
	) => () => void
	asset: (id: string, signal: AbortSignal) => Promise<StoredAsset | null>
	request: (
		url: string,
		id: string,
		signal: AbortSignal
	) => Promise<{ bytes: Uint8Array; mediaType: string }>
	spawnReady: (spawn: ImageSpawner, draft: ReadyImageWrite) => ImageStageRef
	spawnFailure: (spawn: ImageSpawner, draft: FailedImageWrite) => ImageStageRef
}
