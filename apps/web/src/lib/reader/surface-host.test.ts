import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { serveReaderSurface } from './surface-host.js'
import { closeViewportDOMs, installViewportDOM, viewportDOM } from './viewport.test-support.js'

beforeEach(() => {
	installViewportDOM()
	vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) =>
		setTimeout(() => callback(0), 1)
	)
	vi.stubGlobal('cancelAnimationFrame', (id: number) => clearTimeout(id))
})
afterEach(() => {
	closeViewportDOMs()
	vi.unstubAllGlobals()
})

it.each([false, true])(
	'acknowledges cleanup without claiming viewport closure after observer failure (%s)',
	async (fail) => {
		if (fail)
			vi.stubGlobal('ResizeObserver', function () {
				throw new Error('Native observation unavailable')
			})
		const dom = viewportDOM(),
			data = new MessageChannel(),
			replies: { type: string; id?: string; outcome?: string }[] = []
		data.port1.onmessage = ({ data }) => replies.push(data)
		const surface = serveReaderSurface(data.port2, dom)
		try {
			data.port1.postMessage({ type: 'VIEWPORT_OPEN', attachmentId: crypto.randomUUID() })
			if (fail) {
				await vi.waitFor(() =>
					expect(replies.filter((reply) => reply.type === 'VIEWPORT_FAILED')).toHaveLength(1)
				)
				expect(
					replies.some((reply) => reply.type === 'VIEWPORT_SETTLED' && reply.outcome === 'closed')
				).toBe(false)
			} else {
				await vi.waitFor(() => expect(dom.rootBounds).toHaveBeenCalled())
				surface.detach()
				await vi.waitFor(() =>
					expect(
						replies.filter(
							(reply) => reply.type === 'VIEWPORT_SETTLED' && reply.outcome === 'closed'
						)
					).toHaveLength(1)
				)
				expect(replies.some((reply) => reply.type === 'VIEWPORT_FAILED')).toBe(false)
			}
			const id = crypto.randomUUID()
			data.port1.postMessage({ type: 'DISPOSE', id })
			await vi.waitFor(() => expect(replies).toContainEqual({ type: 'DISPOSED', id }))
		} finally {
			surface.detach()
			data.port1.close()
			data.port2.close()
		}
	}
)
