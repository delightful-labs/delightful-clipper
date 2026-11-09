import type { EventPayload } from '../machines/events.js'
import { types, createActor, setup, waitFor, type InputFrom } from 'xstate'
import { expect, it, vi } from 'vitest'

import { imageViewMachine } from './view-machine.js'
import type { ImageViewReport } from './view-machine.js'
import type { ArticleImage } from './schema.js'
function owner(input: InputFrom<typeof imageViewMachine>) {
	const reports: ImageViewReport[] = []
	const model = setup({
		schemas: {
			context: types<{}>(),
			events: { IMAGE_VIEW: types<EventPayload<ImageViewReport, 'IMAGE_VIEW'>>() },
			children: { view: types<import('xstate').ActorRefFrom<typeof imageViewMachine>>() }
		},
		actors: { view: imageViewMachine }
	}).createMachine({
		context: {},
		invoke: { id: 'view', src: 'view', input },
		on: {
			IMAGE_VIEW: (args, enq) => {
				const { event } = args
				enq(() => reports.push(event))
			}
		}
	})
	const actor = createActor(model).start()
	return { actor, reports, child: actor.getSnapshot().children.view! }
}
const row: ArticleImage = {
	id: crypto.randomUUID(),
	documentId: crypto.randomUUID(),
	libraryId: crypto.randomUUID(),
	sourceUrl: 'https://example.com/photo.png',
	status: 'pending',
	assetId: null,
	retryable: true
}
it('reports pending/failed native rows to its owning actor and disposes its subscription', async () => {
	let update: ((rows: ArticleImage[]) => void) | undefined
	const dispose = vi.fn()
	const { actor, reports } = owner({
		documentId: row.documentId,
		sourceUrl: row.sourceUrl,
		capability: {
			isCurrent: () => true,
			subscribeImage: (_document, _url, next) => {
				update = next
				next([row])
				return dispose
			},
			asset: async () => null
		}
	})
	update?.([{ ...row, status: 'failed' }])
	await waitFor(actor, () => reports.some((report) => report.view.status === 'failed'))
	expect(reports.at(-1)?.view.retry).toBe(true)
	expect(reports.at(-1)?.view.message?.text).toContain('image')
	actor.stop()
	expect(dispose).toHaveBeenCalledOnce()
})
it('owns blob URLs, reports decode errors, reloads saved bytes on Retry and ignores stale URL errors', async () => {
	const revoke = vi.spyOn(URL, 'revokeObjectURL'),
		dispose = vi.fn(),
		ready: ArticleImage = { ...row, status: 'ready', assetId: row.id }
	const payload = new Uint8Array(
		Buffer.from(
			'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=',
			'base64'
		)
	)
	const { actor, reports, child } = owner({
		documentId: row.documentId,
		sourceUrl: row.sourceUrl,
		capability: {
			isCurrent: () => true,
			subscribeImage: (_document, _url, next) => {
				next([ready])
				return dispose
			},
			asset: async () => ({
				id: row.id,
				operationId: row.id,
				libraryId: row.libraryId,
				mediaType: 'image/png',
				payload
			})
		}
	})
	try {
		await waitFor(actor, () => reports.at(-1)?.view.status === 'ready')
		const first = reports.at(-1)!.view.url!
		child.send({ type: 'IMAGE_ERROR', id: row.id, url: first })
		expect(reports.at(-1)?.view.status).toBe('failed')
		expect(revoke).toHaveBeenCalledWith(first)
		child.send({ type: 'RETRY', id: row.id })
		await waitFor(actor, () => reports.at(-1)?.view.status === 'ready')
		const second = reports.at(-1)!.view.url!
		expect(second).not.toBe(first)
		child.send({ type: 'IMAGE_ERROR', id: row.id, url: first })
		expect(reports.at(-1)?.view.status).toBe('ready')
		actor.stop()
		expect(revoke).toHaveBeenCalledWith(second)
		expect(dispose).toHaveBeenCalledOnce()
	} finally {
		actor.stop()
		revoke.mockRestore()
	}
})
