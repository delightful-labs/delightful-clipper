import type { ReaderSurface } from './surface.js'
import type { ViewportElements } from './viewport.js'
import { supportsReaderFullscreen, isReaderFullscreen } from './fullscreen.js'
export function nativeReaderSurface(elements: ViewportElements): ReaderSurface {
	const document = elements.root.ownerDocument
	return {
		viewport: { native: elements },
		fullscreen: {
			supported: () => supportsReaderFullscreen(document),
			active: () => isReaderFullscreen(document),
			enter: () => document.documentElement.requestFullscreen(),
			exit: () => document.exitFullscreen(),
			observe: (changed) => {
				document.addEventListener('fullscreenchange', changed)
				return () => document.removeEventListener('fullscreenchange', changed)
			}
		}
	}
}
