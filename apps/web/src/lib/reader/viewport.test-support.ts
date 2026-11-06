import { JSDOM } from 'jsdom'
import { vi } from 'vitest'
import { positionAt, readingTextIndex } from './anchors.js'

const windows: JSDOM[] = []
export class TestResizeObserver implements ResizeObserver {
	static instances: TestResizeObserver[] = []
	observe = vi.fn<ResizeObserver['observe']>()
	unobserve = vi.fn<ResizeObserver['unobserve']>()
	disconnect = vi.fn<ResizeObserver['disconnect']>()
	constructor(readonly callback: ResizeObserverCallback) {
		TestResizeObserver.instances.push(this)
	}
}
export function installViewportDOM() {
	TestResizeObserver.instances = []
	vi.stubGlobal('ResizeObserver', TestResizeObserver)
}
export function closeViewportDOMs() {
	for (const dom of windows.splice(0)) dom.window.close()
}
export function viewportDOM() {
	const dom = new JSDOM('<main><section>' + 'r'.repeat(100) + '</section></main>')
	windows.push(dom)
	const document = dom.window.document,
		scroller = document.querySelector('main')!,
		root = document.querySelector('section')!
	let width = 800,
		fullscreen = false
	const rect = (y: number, height: number) => new dom.window.DOMRect(0, y, width, height)
	const rootBounds = vi
		.spyOn(root, 'getBoundingClientRect')
		.mockImplementation(() => rect(-scroller.scrollTop, 100))
	vi.spyOn(scroller, 'getBoundingClientRect').mockImplementation(() => rect(0, 10))
	Object.defineProperty(dom.window.Range.prototype, 'getBoundingClientRect', {
		configurable: true,
		value: function (this: Range) {
			return rect(this.startOffset - scroller.scrollTop, 1)
		}
	})
	const setFullscreen = (value: boolean) => {
		fullscreen = value
		document.dispatchEvent(new dom.window.Event('fullscreenchange'))
	}
	const enter = vi.fn(async () => setFullscreen(true)),
		exit = vi.fn(async () => setFullscreen(false))
	Object.defineProperty(document, 'fullscreenEnabled', { value: true, configurable: true })
	Object.defineProperty(document, 'fullscreenElement', {
		get: () => (fullscreen ? document.documentElement : null),
		configurable: true
	})
	Object.defineProperty(document.documentElement, 'requestFullscreen', {
		value: enter,
		configurable: true
	})
	Object.defineProperty(document, 'exitFullscreen', { value: exit, configurable: true })
	return {
		root,
		scroller,
		document,
		rootBounds,
		enter,
		exit,
		setFullscreen,
		position: (offset: number) => {
			const position = positionAt(readingTextIndex(root), offset, offset / 100)
			if (!position) throw new Error('Invalid test position')
			return position
		},
		interact: () => scroller.dispatchEvent(new dom.window.Event('wheel', { bubbles: true })),
		scroll: (offset: number) => {
			scroller.scrollTop = offset
			scroller.dispatchEvent(new dom.window.Event('scroll'))
		},
		resize: (value: number) => {
			width = value
			for (const observer of TestResizeObserver.instances) observer.callback([], observer)
		}
	}
}
