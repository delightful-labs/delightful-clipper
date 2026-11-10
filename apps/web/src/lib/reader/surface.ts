import type { ReadingPosition } from './schema.js'
import type { ViewportElements } from './viewport.js'
export type FullscreenSurface = {
	supported: () => boolean
	active: () => boolean
	enter: () => Promise<void>
	exit: () => Promise<void>
	observe: (changed: () => void) => () => void
}
export type ReaderSurface = {
	lifecycle?: { accepted: () => void; released: () => void }
	fullscreen: FullscreenSurface
	viewport: { native: ViewportElements } | { port: MessagePort }
}
export type SurfaceViewportInput = ReaderSurface['viewport'] & {
	attachmentId: string
	position: ReadingPosition | undefined
}
