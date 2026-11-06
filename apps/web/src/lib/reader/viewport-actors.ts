import { fromCallback } from 'xstate'
import type { ReadingViewport } from '../contracts/reader.js'
import type { ReadingPosition } from './schema.js'
import type { ReaderExperienceEvent } from '../machines/reader/experience.js'
type Input = { id: string; viewport: ReadingViewport }
export const viewportObservation = fromCallback<ReaderExperienceEvent, Input>(
	({ input, sendBack }) => {
		try {
			return input.viewport.observe((event) => sendBack({ ...event, attachmentId: input.id }))
		} catch {
			sendBack({ type: 'VIEWPORT_FAILED', attachmentId: input.id })
			return
		}
	}
)
/** Schedule one restoration after layout, then wait a paint before admitting scroll observations. */
export const viewportRestoration = fromCallback<
	ReaderExperienceEvent,
	Input & { position: ReadingPosition | undefined }
>(({ input, sendBack }) => {
	let frame = requestAnimationFrame(() => {
		try {
			input.viewport.restore(input.position)
			frame = requestAnimationFrame(() => sendBack({ type: 'RESTORED', attachmentId: input.id }))
		} catch {
			sendBack({ type: 'VIEWPORT_FAILED', attachmentId: input.id })
		}
	})
	return () => cancelAnimationFrame(frame)
})
