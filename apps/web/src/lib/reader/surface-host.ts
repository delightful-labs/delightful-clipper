import type { ViewportReply } from './surface-viewport.js'
import { createActor, type ActorRefFrom } from 'xstate'
import { z } from 'zod'
import { viewportMachine } from './viewport.js'

import type { ViewportElements } from './viewport.js'
import { positionSchema } from './schema.js'
import { nativeReaderSurface } from './native-surface.js'
const command = z.discriminatedUnion('type', [
	z.object({
		type: z.literal('VIEWPORT_OPEN'),
		attachmentId: z.string().uuid(),
		position: positionSchema.optional()
	}),
	z.object({ type: z.enum(['DETACH', 'REFLOW']) }),
	z.object({ type: z.literal('DISPOSE'), id: z.string().uuid().optional() }),
	z.object({ type: z.enum(['FULLSCREEN_ENTER', 'FULLSCREEN_EXIT']), id: z.string().uuid() })
])
/** UI resource boundary: the viewport actor reads layout and applies scrolling.
 * It reports measurements; it has no account, database or persistence capability. */
export function serveReaderSurface(port: MessagePort, elements: ViewportElements) {
	const surface = nativeReaderSurface(elements)
	const reportViewport = (message: ViewportReply) => port.postMessage(message)
	let viewport: ActorRefFrom<typeof viewportMachine> | undefined
	let released = false
	let disposeRequest: { id?: string | undefined } | undefined
	const detach = () => {
		released = true
		if (viewport?.getSnapshot().status === 'active') viewport.send({ type: 'DETACH' })
	}
	const fullscreen = (id?: string, ok = true) =>
		port.postMessage({
			type: 'FULLSCREEN',
			id,
			ok,
			supported: surface.fullscreen.supported(),
			active: surface.fullscreen.active()
		})
	const releaseFullscreen = surface.fullscreen.observe(() => fullscreen())
	let disposed = false
	const dispose = (id?: string) => {
		if (disposed) return
		disposed = true
		releaseFullscreen()
		port.onmessage = null
		if (id) port.postMessage({ type: 'DISPOSED', id })
		port.close()
	}

	port.onmessage = ({ data }: MessageEvent<unknown>) => {
		const decoded = command.safeParse(data)
		if (!decoded.success) return
		const message = decoded.data
		switch (message.type) {
			case 'VIEWPORT_OPEN': {
				if (released) {
					const previous = viewport?.getSnapshot()
					if (previous && previous.status !== 'done') {
						reportViewport({ type: 'VIEWPORT_FAILED', attachmentId: message.attachmentId })
						return
					}
					reportViewport({
						type: 'VIEWPORT_SETTLED',
						attachmentId: message.attachmentId,
						outcome: previous && !previous.matches('closed') ? 'failed' : 'closed'
					})
					return
				}
				if (viewport) return
				const actor = createActor(viewportMachine, {
					input: {
						...elements,
						attachmentId: message.attachmentId,
						position: message.position,
						report: reportViewport
					}
				})
				viewport = actor
				actor.subscribe({
					complete: () => {
						const snapshot = actor.getSnapshot()
						if (snapshot.status === 'done' && snapshot.output)
							reportViewport({
								type: 'VIEWPORT_SETTLED',
								attachmentId: message.attachmentId,
								outcome: snapshot.matches('closed') ? 'closed' : 'failed',
								position: snapshot.output.position
							})
						else reportViewport({ type: 'VIEWPORT_FAILED', attachmentId: message.attachmentId })
						if (disposeRequest) dispose(disposeRequest.id)
					},
					error: () =>
						reportViewport({
							type: 'VIEWPORT_FAILED',
							attachmentId: message.attachmentId
						})
				})
				actor.start()
				if (actor.getSnapshot().status === 'active')
					reportViewport({ type: 'VIEWPORT_OPENED', attachmentId: message.attachmentId })
				break
			}
			case 'REFLOW':
				viewport?.send({ type: 'REFLOW' })
				break
			case 'DETACH':
				detach()
				break
			case 'FULLSCREEN_ENTER':
				void surface.fullscreen.enter().then(
					() => fullscreen(message.id),
					() => fullscreen(message.id, false)
				)
				break
			case 'FULLSCREEN_EXIT':
				void surface.fullscreen.exit().then(
					() => fullscreen(message.id),
					() => fullscreen(message.id, false)
				)
				break
			case 'DISPOSE':
				disposeRequest = message
				if (viewport?.getSnapshot().status === 'active') detach()
				else dispose(message.id)
		}
	}
	port.start()
	return {
		fullscreen: { supported: surface.fullscreen.supported(), active: surface.fullscreen.active() },
		detach
	}
}
