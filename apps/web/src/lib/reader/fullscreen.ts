/** Native capability facts; the reader statechart decides admission and exit. */
export function supportsReaderFullscreen(document: Document | undefined): document is Document {
	return (
		!!document?.fullscreenEnabled &&
		typeof document.documentElement.requestFullscreen === 'function'
	)
}
export function isReaderFullscreen(document: Document | undefined) {
	return !!document && document.fullscreenElement === document.documentElement
}
