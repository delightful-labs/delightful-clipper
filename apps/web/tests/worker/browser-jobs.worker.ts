// The extension's Chrome declarations are ambient globals, not an importable module.
// oxlint-disable-next-line typescript/triple-slash-reference
/// <reference path="../../../extension/node_modules/@types/chrome/index.d.ts" />
import { createActor } from 'xstate'
import { z } from 'zod'
import { imageJob, imageJobMachine } from '../../src/lib/images/processing-job.js'
import { extractionJob, extractionJobMachine } from '../../../extension/src/worker.js'
import type {
	BrowserWorkerJobInput,
	BrowserJobWorker
} from '../../src/lib/machines/browser-worker-job.js'

const request = z.object({
	mode: z.enum(['image', 'extract']),
	fault: z.enum(['none', 'post', 'cancel'])
})
function instrument<Request, Reply>(
	job: BrowserWorkerJobInput<Request, Reply>,
	fault: z.infer<typeof request>['fault']
) {
	let worker: BrowserJobWorker | undefined
	let posts = 0,
		terminations = 0
	return {
		input: {
			...job,
			open: () => {
				const native = job.open()
				worker = native
				const post = native.postMessage,
					terminate = native.terminate
				native.postMessage = (
					message: unknown,
					options?: Transferable[] | StructuredSerializeOptions
				) => {
					posts++
					if (fault === 'cancel') return
					if (fault === 'post') {
						post.call(native, { notCloneable: () => {} }, {})
						return
					}
					post.call(native, message, Array.isArray(options) ? { transfer: options } : options)
				}
				native.terminate = () => {
					terminations++
					terminate.call(native)
				}
				return native
			}
		},
		facts: () => ({
			posts,
			terminations,
			handlersRemoved:
				!!worker &&
				worker.onmessage === null &&
				worker.onerror === null &&
				worker.onmessageerror === null
		})
	}
}

self.onmessage = async ({ data }: MessageEvent<unknown>) => {
	const { mode, fault } = request.parse(data)
	if (mode === 'image') {
		const canvas = new OffscreenCanvas(3, 2),
			context = canvas.getContext('2d')!
		context.fillStyle = '#204060'
		context.fillRect(0, 0, 3, 2)
		const bytes = new Uint8Array(
			await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()
		)
		const job = instrument(imageJob({ bytes, mediaType: 'image/png' }), fault)
		const actor = createActor(imageJobMachine, { input: job.input })
		actor.subscribe({
			complete: () => {
				const output = actor.getSnapshot().output
				if (!output) {
					self.postMessage({ failed: true })
					return
				}
				self.postMessage({
					outcome: output.kind,
					reason: output.kind === 'failed' ? output.reason : undefined,
					...job.facts(),
					image:
						output.kind === 'replied' && output.reply.kind === 'ready'
							? {
									width: output.reply.result.width,
									height: output.reply.result.height,
									mediaType: output.reply.result.mediaType,
									bytes: output.reply.result.bytes.length
								}
							: undefined
				})
			},
			error: () => self.postMessage({ failed: true })
		})
		actor.start()
		if (fault === 'cancel') actor.send({ type: 'CANCEL' })
	} else {
		const url = 'https://example.com/browser-job'
		const job = instrument(
			extractionJob({
				url,
				base: url,
				html: `<html><head><title>Worker extraction fixture</title></head><body><article><h1>Worker extraction fixture</h1><p>${'Native browser worker extraction fixture prose. '.repeat(40)}</p></article></body></html>`
			}),
			fault
		)
		const actor = createActor(extractionJobMachine, { input: job.input })
		actor.subscribe({
			complete: () => {
				const output = actor.getSnapshot().output
				if (!output) {
					self.postMessage({ failed: true })
					return
				}
				self.postMessage({
					outcome: output.kind,
					reason: output.kind === 'failed' ? output.reason : undefined,
					...job.facts(),
					content:
						output.kind === 'replied' && 'content' in output.reply
							? {
									title: output.reply.content.title,
									sameSource: output.reply.content.finalUrl === url,
									text: output.reply.content.text.includes(
										'Native browser worker extraction fixture prose.'
									)
								}
							: undefined
				})
			},
			error: () => self.postMessage({ failed: true })
		})
		actor.start()
		if (fault === 'cancel') actor.send({ type: 'CANCEL' })
	}
}
