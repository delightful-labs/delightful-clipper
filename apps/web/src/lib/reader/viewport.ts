import type { ReadingViewport } from '../contracts/reader.js'
import { readingTextIndex, rangeAt, positionAt, quoteMatches } from './anchors.js'
import { readingFullscreen } from './fullscreen.js'
function isReadingInteraction(event: Event, root: HTMLElement, scroller: HTMLElement) {
	const target = event.target
	if (!(target instanceof root.ownerDocument.defaultView!.Element)) return false
	if (target.closest('dialog, [popover], input, textarea, select, button')) return false
	if (event.type === 'wheel' || event.type === 'touchstart') return true
	return target === scroller || root.contains(target) || !!target.closest('[data-reader-contents]')
}
/** Native I/O only: observation and defined measure/restore commands; the parent owns admission. */
export function readingViewport(root: HTMLElement, scroller: HTMLElement): ReadingViewport {
	const index = readingTextIndex(root)
	const viewportTop = () => {
		const top = scroller.getBoundingClientRect().top
		return Array.from(scroller.querySelectorAll<HTMLElement>('[data-reader-overlay]')).reduce(
			(edge, overlay) => {
				const rect = overlay.getBoundingClientRect()
				return rect.top <= top + 1 && rect.bottom > top ? Math.max(edge, rect.bottom) : edge
			},
			top
		)
	}
	const measurePosition = () => {
		if (!index.points.length || !root.isConnected || !root.getBoundingClientRect().height)
			return undefined
		const top = viewportTop()
		let low = 0,
			high = index.points.length - 1
		while (low < high) {
			const middle = Math.floor((low + high) / 2)
			const rect = rangeAt(index, middle)?.getBoundingClientRect()
			if (!rect || rect.bottom <= top) low = middle + 1
			else high = middle
		}
		const end = root.getBoundingClientRect().bottom <= scroller.getBoundingClientRect().bottom + 2
		return positionAt(index, low, end ? 1 : low / index.points.length)
	}
	const fullscreen = readingFullscreen(root.ownerDocument)
	return {
		...(fullscreen ? { fullscreen } : {}),
		measure: measurePosition,
		restore: (position) => {
			if (!position || !quoteMatches(index, position)) {
				scroller.scrollTop = 0
				return
			}
			const rect = rangeAt(index, position.offset)?.getBoundingClientRect()
			if (!rect || !rect.height) {
				scroller.scrollTop = 0
				return
			}
			scroller.scrollTop += rect.top - viewportTop()
		},
		observe: (report) => {
			const targets = [
				root,
				scroller,
				...scroller.querySelectorAll<HTMLElement>('[data-reader-overlay]')
			]
			const sizes = () =>
				targets.map((target) => {
					const { width, height } = target.getBoundingClientRect()
					return { width, height }
				})
			const controller = new AbortController()
			const resize = new ResizeObserver(() => {
				try {
					report({ type: 'RESIZE', sizes: sizes() })
				} catch {
					report({ type: 'VIEWPORT_FAILED' })
				}
			})
			const dispose = () => {
				resize.disconnect()
				controller.abort()
			}
			const scroll = () => report({ type: 'SCROLL' })
			const interact = (event: Event) =>
				report({ type: 'INTERACT', eligible: isReadingInteraction(event, root, scroller) })
			try {
				report({ type: 'BASELINE', sizes: sizes() })
				for (const target of targets) resize.observe(target)
				const options = { passive: true, signal: controller.signal }
				scroller.addEventListener('scroll', scroll, options)
				for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
					scroller.addEventListener(name, interact, options)
				return dispose
			} catch (error) {
				dispose()
				throw error
			}
		}
	}
}
