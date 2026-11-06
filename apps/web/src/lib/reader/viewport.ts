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
		measure: () => {
			try {
				return measurePosition()
			} catch {
				return undefined
			}
		},
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
			let frame: number | undefined
			const measure = () => {
				frame = undefined
				try {
					const position = measurePosition()
					if (position) report({ type: 'MEASURE', position })
				} catch {
					report({ type: 'VIEWPORT_FAILED' })
				}
			}
			const scroll = () => {
				if (frame === undefined) frame = requestAnimationFrame(measure)
			}
			const interact = (event: Event) => {
				if (!isReadingInteraction(event, root, scroller)) return
				report({ type: 'INTERACT' })
				scroll()
			}
			const sizes = new Map<Element, { width: number; height: number }>()
			const resize = new ResizeObserver((entries) => {
				let changed = false
				for (const { target } of entries) {
					const rect = target.getBoundingClientRect()
					const previous = sizes.get(target)
					if (previous?.width !== rect.width || previous.height !== rect.height) changed = true
					sizes.set(target, { width: rect.width, height: rect.height })
				}
				if (changed) report({ type: 'RESIZE' })
			})
			for (const target of [
				root,
				scroller,
				...scroller.querySelectorAll('[data-reader-overlay]')
			]) {
				const { width, height } = target.getBoundingClientRect()
				sizes.set(target, { width, height })
				resize.observe(target)
			}
			scroller.addEventListener('scroll', scroll, { passive: true })
			for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
				scroller.addEventListener(name, interact, { passive: true })
			return () => {
				resize.disconnect()
				scroller.removeEventListener('scroll', scroll)
				for (const name of ['wheel', 'touchstart', 'pointerdown', 'keydown'])
					scroller.removeEventListener(name, interact)
				if (frame !== undefined) cancelAnimationFrame(frame)
			}
		}
	}
}
