import type { ImageCapability } from '../contracts/images.js'
import { ImageFetchError, retryAfterMilliseconds } from './failure.js'
import { readResponseBytes } from '../machines/capture/article-worker-io.js'
import { captureErrorSchema } from '../contracts/capture-response.js'
import { IMAGE_INPUT_LIMIT } from './schema.js'

/** Bind image transport to native capabilities; the queue owns acquisition and retries. */
export function createImageCapability(
	capability: Omit<ImageCapability, 'request'>,
	request: (mode: 'asset', body: unknown, signal: AbortSignal) => Promise<Response>
): ImageCapability {
	return {
		...capability,
		request: async (url, id, signal) => {
			const response = await request('asset', { protocolVersion: 1, operationId: id, url }, signal)
			const bytes = await readResponseBytes(
				response,
				signal,
				capability.isCurrent,
				IMAGE_INPUT_LIMIT
			)
			if (!response.ok) {
				let error: unknown
				try {
					error = JSON.parse(new TextDecoder().decode(bytes))
				} catch {
					throw new Error('invalidResponse')
				}
				const parsed = captureErrorSchema.safeParse(error)
				throw new ImageFetchError(
					parsed.success ? parsed.data.code : 'invalidResponse',
					retryAfterMilliseconds(response.headers.get('retry-after'))
				)
			}
			return {
				bytes,
				mediaType: (response.headers.get('content-type') ?? '').split(';')[0]!.toLowerCase()
			}
		}
	}
}
