import {
	createBrowserWorkerJob,
	type BrowserWorkerJobInput
} from '../../web/src/lib/machines/browser-worker-job.js'
import { extractionReplySchema, type Source, type ExtractionReply } from './protocol.js'

export const EXTRACTION_TIMEOUT_MS = 15_000
export const extractionJobMachine = createBrowserWorkerJob<Source, ExtractionReply>()
/** Inert selected request; construction belongs to the invoked job. */
export function extractionJob(source: Source): BrowserWorkerJobInput<Source, ExtractionReply> {
	return {
		open: () => new Worker(new URL('./extract-worker.ts', import.meta.url), { type: 'module' }),
		message: source,
		decode: (value) => extractionReplySchema.parse(value)
	}
}
