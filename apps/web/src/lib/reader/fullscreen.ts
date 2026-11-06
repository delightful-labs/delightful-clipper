import type { ReadingFullscreen } from '../contracts/reader.js'

/** Native fullscreen I/O; admission, fallback and pending-request lifetime belong to the reader. */
export function readingFullscreen(document: Document): ReadingFullscreen | undefined {
	const root = document.documentElement
	if (!document.fullscreenEnabled || typeof root.requestFullscreen !== 'function') return undefined
	return {
		enter: () => root.requestFullscreen(),
		exit: async () => {
			if (document.fullscreenElement === root) await document.exitFullscreen()
		},
		observe: (exited) => {
			const change = () => {
				if (document.fullscreenElement !== root) exited()
			}
			document.addEventListener('fullscreenchange', change)
			return () => document.removeEventListener('fullscreenchange', change)
		}
	}
}
