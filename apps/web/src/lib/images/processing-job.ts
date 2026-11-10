import {
	createBrowserWorkerJob,
	type BrowserWorkerJobInput,
	type BrowserWorkerJobResult
} from '../machines/browser-worker-job.js'
import { imageWorkerReplySchema, type ImageWorkerReply, type ProcessedImage } from './schema.js'

export type ImageJobRequest = { bytes: Uint8Array; mediaType: string }
export const IMAGE_PROCESS_TIMEOUT_MS = 20_000
export const imageJobMachine = createBrowserWorkerJob<ImageJobRequest, ImageWorkerReply>()
export function hasImageResult(
	result: BrowserWorkerJobResult<ImageWorkerReply>
): result is BrowserWorkerJobResult<ImageWorkerReply> & {
	kind: 'replied'
	reply: { kind: 'ready'; result: ProcessedImage }
} {
	return result.kind === 'replied' && result.reply.kind === 'ready'
}
export function imageJob(
	message: ImageJobRequest
): BrowserWorkerJobInput<ImageJobRequest, ImageWorkerReply> {
	return {
		open: () => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }),
		message,
		decode: (value) => imageWorkerReplySchema.parse(value)
	}
}
