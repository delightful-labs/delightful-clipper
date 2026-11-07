import { assign, fromCallback, fromPromise, sendParent, setup } from 'xstate'
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
const observe = fromCallback<Event, Input>(({ input, sendBack }) =>
	input.capability.subscribeImage(
		input.documentId,
		input.sourceUrl,
		(rows) => sendBack({ type: 'ROWS', rows }),
		() => sendBack({ type: 'FAILED' })
	)
)
const load = fromPromise<StoredAsset | null, Context>(({ input, signal }) =>
	input.capability.asset(input.row!.assetId!, signal)
)
const url = fromCallback<Event, StoredAsset>(({ input, sendBack }) => {
	const url = URL.createObjectURL(
		new Blob([new Uint8Array(input.payload)], { type: input.mediaType })
	)
	sendBack({ type: 'URL', url })
	return () => URL.revokeObjectURL(url)
})
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
const model = setup<
	Context,
	Event,
	{ observe: typeof observe; load: typeof load; url: typeof url },
	{},
	{},
	{
		changedRow: undefined
		pending: undefined
		ready: undefined
		validAsset: { asset: StoredAsset | null }
	},
	never,
	string,
	Input
>({
	actors: { observe, load, url },
	guards: {
		changedRow: ({ context, event }) =>
			event.type === 'ROWS' &&
			(context.row?.id !== event.rows[0]?.id ||
				context.row?.status !== event.rows[0]?.status ||
				context.row?.assetId !== event.rows[0]?.assetId),
		pending: ({ context }) => !context.row || context.row.status === 'pending',
		ready: ({ context }) => context.row?.status === 'ready',
		validAsset: ({ context }, params) => validImageAsset(context, params.asset)
	}
})
const report = (view: (context: Context) => ImageView) =>
	sendParent<Context, Event, undefined, ImageViewReport, Event>(
		({ context }: { context: Context }): ImageViewReport => ({
			type: 'IMAGE_VIEW',
			documentId: context.documentId,
			sourceUrl: context.sourceUrl,
			view: { ...view(context), ...(context.row ? { id: context.row.id } : {}) }
		})
	)

export const imageViewMachine = model.createMachine({
	id: 'image-view',
	context: ({ input }) => ({ ...input, row: undefined, asset: null, url: undefined }),
	initial: 'observing',
	states: {
		observing: {
			invoke: { src: 'observe', input: ({ context }) => context, onError: '.failed' },
			initial: 'pending',
			on: {
				ROWS: {
					guard: 'changedRow',
					target: '.routing',
					actions: assign({ row: ({ event }) => event.rows[0], asset: null, url: undefined })
				},
				FAILED: '.failed',
				IMAGE_ERROR: {
					guard: ({ context, event }) =>
						event.type === 'IMAGE_ERROR' &&
						context.row?.id === event.id &&
						context.url === event.url,
					target: '.failed',
					actions: assign({ url: undefined })
				},
				RETRY: {
					guard: ({ context, event }) =>
						event.type === 'RETRY' &&
						context.row?.id === event.id &&
						context.row.status === 'ready',
					target: '.loading',
					actions: assign({ url: undefined })
				},
				UNKNOWN: {
					guard: ({ context, event }) =>
						event.type === 'UNKNOWN' &&
						event.sourceUrl === context.sourceUrl &&
						context.row?.status !== 'ready',
					target: '.unknown'
				}
			},
			states: {
				routing: {
					always: [
						{ guard: 'pending', target: 'pending' },
						{ guard: 'ready', target: 'loading' },
						{ target: 'failed' }
					]
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
						src: 'load',
						input: ({ context }) => context,
						onDone: [
							{
								guard: { type: 'validAsset', params: ({ event }) => ({ asset: event.output }) },
								target: 'owningURL',
								actions: assign({ asset: ({ event }) => event.output })
							},
							{ target: 'failed' }
						],
						onError: 'failed'
					}
				},
				owningURL: {
					initial: 'creating',
					invoke: { src: 'url', input: ({ context }) => context.asset!, onError: 'failed' },
					states: {
						creating: {
							on: {
								URL: { target: 'available', actions: assign({ url: ({ event }) => event.url }) }
							}
						},
						available: {
							entry: report((context) => ({ status: 'ready', retry: false, url: context.url! }))
						}
					}
				}
			}
		}
	}
})
