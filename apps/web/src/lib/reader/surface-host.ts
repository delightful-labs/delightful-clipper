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
	z.object({ type: z.enum(['DETACH', 'REFLOW', 'DISPOSE']) }),
	z.object({ type: z.enum(['FULLSCREEN_ENTER', 'FULLSCREEN_EXIT']), id: z.string().uuid() })
])
/** UI resource boundary: the viewport actor reads layout and applies scrolling.
 * It reports measurements; it has no account, database or persistence capability. */
export function serveReaderSurface(port: MessagePort, elements: ViewportElements) {
	const surface = nativeReaderSurface(elements)
	let viewport: ActorRefFrom<typeof viewportMachine> | undefined
	let released = false
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
	const dispose = () => {
		releaseFullscreen()
		port.onmessage = null
		port.close()
	}
	port.onmessage = ({ data }: MessageEvent<unknown>) => {
		const decoded = command.safeParse(data)
		if (!decoded.success) return
		const message = decoded.data
		switch (message.type) {
			case 'VIEWPORT_OPEN': {
				if (released) {
					port.postMessage({ type: 'VIEWPORT_CLOSED' })
					return
				}
				if (viewport) return
				const actor = createActor(viewportMachine, {
					input: {
						...elements,
						attachmentId: message.attachmentId,
						position: message.position,
						report: (event) => port.postMessage(event)
					}
				})
				viewport = actor
				actor.subscribe({
					complete: () =>
						port.postMessage({
							type: 'VIEWPORT_CLOSED',
							position: actor.getSnapshot().output?.position
						}),
					error: () =>
						port.postMessage({
							type: 'VIEWPORT_FAILED',
							attachmentId: message.attachmentId
						})
				})
				actor.start()
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
				dispose()
		}
	}
	port.start()
	return {
		fullscreen: { supported: surface.fullscreen.supported(), active: surface.fullscreen.active() },
		detach
	}
}
