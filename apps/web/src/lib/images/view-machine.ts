import type { EventPayload } from '../machines/events.js'
import {
	types,
	createCallbackLogic,
	setup,
	createAsyncLogic,
	type EnqueueObject,
	type ActorRef,
	type Snapshot
} from 'xstate'

import type { ImageCapability } from '../contracts/images.js'
import type { ArticleImage } from './schema.js'
import { IMAGE_OUTPUT_LIMIT } from './schema.js'
import { imageDimensions } from './dimensions.js'
import type { StoredAsset } from '../contracts/storage.js'
import type { WorkflowMessage } from '../contracts/feedback.js'
import { action, t } from '../localization/index.js'
export type ImageView = {
	id?: string
	status: 'pending' | 'ready' | 'failed' | 'unknown'
	url?: string
	message?: WorkflowMessage
	retry: boolean
}
type Input = {
	reportTo: ActorRef<Snapshot<unknown>, ImageViewReport>
	capability: Pick<ImageCapability, 'isCurrent' | 'subscribeImage' | 'asset'>
	documentId: string
	sourceUrl: string
}
type Context = Input & {
	row: ArticleImage | undefined
	asset: StoredAsset | null
	url: string | undefined
}
type Event =
	| { type: 'ROWS'; rows: ArticleImage[] }
	| { type: 'FAILED' }
	| { type: 'UNKNOWN'; sourceUrl: string }
	| { type: 'RETRY'; id: string }
	| { type: 'IMAGE_ERROR'; id: string; url: string }
	| { type: 'URL'; url: string }
export type ImageViewReport = {
	type: 'IMAGE_VIEW'
	documentId: string
	sourceUrl: string
	view: ImageView
}
const observe = createCallbackLogic<Event, Input>(({ input, sendBack }) =>
	input.capability.subscribeImage(
		input.documentId,
		input.sourceUrl,
		(rows) => sendBack({ type: 'ROWS', rows }),
		() => sendBack({ type: 'FAILED' })
	)
)
const load = createAsyncLogic<
	StoredAsset | null,
	{ capability: Input['capability']; assetId: string }
>({
	run: ({ input, signal }) => input.capability.asset(input.assetId, signal)
})
const url = createCallbackLogic<Event, StoredAsset>(({ input, sendBack }) => {
	const url = URL.createObjectURL(
		new Blob([new Uint8Array(input.payload)], { type: input.mediaType })
	)
	sendBack({ type: 'URL', url })
	return () => URL.revokeObjectURL(url)
})
function hasReadyImageAsset(
	row: ArticleImage | undefined
): row is ArticleImage & { assetId: string } {
	return row?.status === 'ready' && typeof row.assetId === 'string'
}
function validImageAsset(context: Context, asset: StoredAsset | null) {
	if (!context.capability.isCurrent()) return false
	if (
		!asset ||
		asset.id !== context.row?.assetId ||
		asset.libraryId !== context.row.libraryId ||
		!['image/png', 'image/webp'].includes(asset.mediaType) ||
		asset.payload.length > IMAGE_OUTPUT_LIMIT
	)
		return false
	const size = imageDimensions(asset.payload)
	return !!size && size.width > 0 && size.height > 0 && size.width <= 2048 && size.height <= 2048
}
const model = setup({
	schemas: {
		meta: types<{
			name?: string
			variant?: 'info' | 'error'
			channel?: string
			priority?: number
		}>(),
		context: types<Context>(),
		events: {
			ROWS: types<EventPayload<Event, 'ROWS'>>(),
			FAILED: types<EventPayload<Event, 'FAILED'>>(),
			UNKNOWN: types<EventPayload<Event, 'UNKNOWN'>>(),
			RETRY: types<EventPayload<Event, 'RETRY'>>(),
			IMAGE_ERROR: types<EventPayload<Event, 'IMAGE_ERROR'>>(),
			URL: types<EventPayload<Event, 'URL'>>()
		},
		input: types<Input>(),
		tags: types<string>(),
		children: {
			observe: types<import('xstate').ActorRefFrom<typeof observe>>(),
			load: types<import('xstate').ActorRefFrom<typeof load>>(),
			url: types<import('xstate').ActorRefFrom<typeof url>>()
		}
	},
	states: {
		observing: {
			id: 'image-view.observing',
			states: {
				routing: { id: 'image-view.observing.routing' },
				pending: { id: 'image-view.observing.pending' },
				unknown: { id: 'image-view.observing.unknown' },
				failed: { id: 'image-view.observing.failed' },
				loading: {
					id: 'image-view.observing.loading',
					schemas: { input: types<{ assetId: string }>() }
				},
				owningURL: {
					id: 'image-view.observing.owningURL',
					schemas: { context: types<{ asset: StoredAsset }>() },
					states: {
						creating: { id: 'image-view.observing.owningURL.creating' },
						available: {
							id: 'image-view.observing.owningURL.available',
							schemas: { context: types<{ url: string }>() }
						}
					}
				}
			}
		}
	},
	actors: { observe, load, url },
	guards: {
		changedRow: ({ context, event }: { context: Context; event: Event }) =>
			event.type === 'ROWS' &&
			(context.row?.id !== event.rows[0]?.id ||
				context.row?.status !== event.rows[0]?.status ||
				context.row?.assetId !== event.rows[0]?.assetId),
		pending: ({ context }: { context: Context }) =>
			!context.row || context.row.status === 'pending',
		validAsset: ({ context }: { context: Context }, params: { asset: StoredAsset | null }) =>
			validImageAsset(context, params.asset)
	}
})
const report =
	(view: (context: Context) => ImageView) =>
	({ context }: { context: Context }, enq: EnqueueObject<Event, never>) => {
		enq.sendTo(context.reportTo, {
			type: 'IMAGE_VIEW',
			documentId: context.documentId,
			sourceUrl: context.sourceUrl,
			view: { ...view(context), ...(context.row ? { id: context.row.id } : {}) }
		} satisfies ImageViewReport)
	}

export const imageViewMachine = model.createMachine({
	id: 'image-view',
	context: ({ input }) => ({ ...input, row: undefined, asset: null, url: undefined }),
	initial: 'observing',
	states: {
		observing: {
			invoke: {
				id: 'observe',
				src: 'observe',
				input: ({ context }: { context: Context }) => context,
				onError: { target: '.failed' }
			},
			initial: 'pending',
			on: {
				ROWS: (args) => {
					if (!args.guards.changedRow(args)) return
					return {
						target: '.routing',
						context: { row: args.event.rows[0], asset: null, url: undefined }
					}
				},
				FAILED: { target: '.failed' },
				IMAGE_ERROR: (args) => {
					const { context, event } = args
					if (
						!(
							event.type === 'IMAGE_ERROR' &&
							context.row?.id === event.id &&
							context.url === event.url
						)
					)
						return
					return { target: '.failed', context: { url: undefined } }
				},
				RETRY: (args) => {
					const { context, event } = args
					if (
						!(
							event.type === 'RETRY' &&
							context.row?.id === event.id &&
							context.row.status === 'ready'
						)
					)
						return
					if (!hasReadyImageAsset(context.row)) return
					return {
						target: '.loading',
						input: { assetId: context.row.assetId },
						context: { url: undefined }
					}
				},
				UNKNOWN: (args) => {
					const { context, event } = args
					if (
						!(
							event.type === 'UNKNOWN' &&
							event.sourceUrl === context.sourceUrl &&
							context.row?.status !== 'ready'
						)
					)
						return
					return { target: '.unknown' }
				}
			},
			states: {
				routing: {
					type: 'choice',
					choice: (args) => {
						if (args.guards.pending(args)) {
							return { target: 'pending' }
						}
						const row = args.context.row
						if (hasReadyImageAsset(row)) {
							return { target: 'loading', input: { assetId: row.assetId } }
						}
						return { target: 'failed' }
					}
				},
				pending: { entry: report(() => ({ status: 'pending', retry: false })) },
				unknown: {
					meta: { name: t('status.save_unknown'), variant: 'error' },
					entry: report(() => ({
						status: 'unknown',
						retry: false,
						message: { text: t('status.save_unknown'), variant: 'error' }
					}))
				},
				failed: {
					meta: {
						name: t('status.failed_subject', { subject: action('get', 'image') }),
						variant: 'error'
					},
					entry: report((context) => ({
						status: 'failed',
						retry: !!context.row,
						message: {
							text: t('status.failed_subject', { subject: action('get', 'image') }),
							variant: 'error'
						}
					}))
				},
				loading: {
					entry: report(() => ({ status: 'pending', retry: false })),
					invoke: {
						id: 'load',
						src: 'load',
						input: ({ context, input }) => ({
							capability: context.capability,
							assetId: input.assetId
						}),
						onDone: (args) => {
							const { event } = args
							if (event.output && args.guards.validAsset(args, { asset: event.output })) {
								return { target: 'owningURL', context: { asset: event.output } }
							}
							return { target: 'failed' }
						},
						onError: { target: 'failed' }
					}
				},
				owningURL: {
					initial: 'creating',
					invoke: {
						id: 'url',
						src: 'url',
						input: ({ context }) => context.asset,
						onError: { target: 'failed' }
					},
					states: {
						creating: {
							on: {
								URL: (args) => {
									return { target: 'available', context: { url: args.event.url } }
								}
							}
						},
						available: {
							entry: ({ context }, enq) => {
								enq.sendTo(context.reportTo, {
									type: 'IMAGE_VIEW',
									documentId: context.documentId,
									sourceUrl: context.sourceUrl,
									view: {
										status: 'ready',
										retry: false,
										url: context.url,
										...(context.row ? { id: context.row.id } : {})
									}
								})
							}
						}
					}
				}
			}
		}
	}
})
