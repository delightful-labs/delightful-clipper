import { ReadTier } from 'jazz-tools'
import type { Db } from 'jazz-tools'
import { createDomainTransaction } from '../../machines/storage/domain-transaction.js'
import {
	createImagePublicationDomain,
	createImageFailureDomain
} from '../../machines/storage/image-domains.js'
import type { ImageCapability, ImageSpawner } from '../../contracts/images.js'
import type { ArticleImage, ReadyImageWrite, FailedImageWrite } from '../../images/schema.js'
import { imageRowSchema, processedImageSchema } from '../../images/schema.js'
import { z } from 'zod'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import type { TransactionResource } from './transaction.js'
import { app } from './schema.js'
export function createImageRecords(
	db: Pick<Db, 'one' | 'subscribe' | 'beginTransaction'>,
	libraryId: string,
	isCurrent: () => boolean
) {
	const readImage = async (resource: TransactionResource, id: string) => {
		const row = await resource.tx.one(app.articleImages.where({ id, libraryId }), {
			tier: ReadTier.LocalFirst
		})
		return row ? imageRowSchema.parse(row) : null
	}
	const lifecycle = transactionLifecycle(db, isCurrent)
	const ready = createDomainTransaction<ReadyImageWrite>(
		(spawn, input) =>
			spawn(
				createImagePublicationDomain({
					read: async (resource, input) => {
						const result = processedImageSchema.parse(input.result)
						const draft: ReadyImageWrite = {
							kind: 'ready',
							image: imageRowSchema.parse(input.image),
							result
						}
						const digest = new Uint8Array(
							await crypto.subtle.digest('SHA-256', new Uint8Array(result.bytes))
						)
						const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
						const image = await readImage(resource, draft.image.id)
						const intent = await resource.tx.one(
							app.storageOperations.where({ id: draft.image.id, libraryId }),
							{ tier: ReadTier.LocalFirst }
						)
						return { draft, image, intent, hash }
					},
					insertIntent: (resource, { draft, hash }) => {
						resource.tx.insert(
							app.storageOperations,
							{ libraryId, payloadHash: hash, createdAt: new Date().toISOString() },
							{ id: draft.image.id }
						)
					},
					insertAsset: (resource, { draft }) => {
						resource.tx.insert(
							app.assets,
							{
								libraryId,
								operationId: draft.image.id,
								mediaType: draft.result.mediaType,
								payload: draft.result.bytes
							},
							{ id: draft.image.id }
						)
					},
					publishImage: (resource, { draft }) => {
						resource.tx.update(app.articleImages, draft.image.id, {
							status: 'ready',
							assetId: draft.image.id,
							retryable: false
						})
					},
					receipt: transactionReceipt
				}),
				{ input }
			),
		lifecycle
	)
	const recordImageFailure = createDomainTransaction<FailedImageWrite>(
		(spawn, input) =>
			spawn(
				createImageFailureDomain({
					read: async (resource, input) => {
						const draft: FailedImageWrite = {
							kind: 'failed',
							image: imageRowSchema.parse(input.image),
							retryable: z.boolean().parse(input.retryable)
						}
						return { draft, image: await readImage(resource, draft.image.id) }
					},
					recordFailure: (resource, { draft }) => {
						resource.tx.update(app.articleImages, draft.image.id, {
							status: 'failed',
							assetId: null,
							retryable: draft.retryable
						})
					},
					receipt: transactionReceipt
				}),
				{ input }
			),
		lifecycle
	)
	const subscribe = (
		query: ReturnType<typeof app.articleImages.where>,
		next: (rows: ArticleImage[]) => void,
		error: () => void
	) =>
		db.subscribe(
			query,
			{
				onUpdate: (rows) => {
					const parsed = z.array(imageRowSchema).safeParse(rows)
					if (parsed.success) next(parsed.data)
					else error()
				},
				onError: error
			},
			{ tier: ReadTier.LocalFirst }
		)
	const spawnReady = (spawn: ImageSpawner, draft: ReadyImageWrite) =>
		spawn(ready, {
			input: {
				attempt: {
					operationId: draft.image.id,
					workspaceId: draft.image.id,
					membershipId: draft.image.id,
					draft
				}
			}
		})
	const spawnFailure = (spawn: ImageSpawner, draft: FailedImageWrite) => {
		const operationId = crypto.randomUUID()
		return spawn(recordImageFailure, {
			input: {
				attempt: { operationId, workspaceId: operationId, membershipId: operationId, draft }
			}
		})
	}
	return {
		ready,
		recordImageFailure,
		capability: {
			isCurrent,
			hasIntent: async (id: string, _signal: AbortSignal) =>
				!!(await db.one(app.storageOperations.where({ id, libraryId }), {
					tier: ReadTier.LocalFirst,
					firstLoadRemoteWaitMs: 5_000
				})),
			spawnReady,
			spawnFailure,
			subscribe: (next, error) => subscribe(app.articleImages.where({ libraryId }), next, error),
			subscribeImage: (documentId, sourceUrl, next, error) =>
				subscribe(app.articleImages.where({ libraryId, documentId, sourceUrl }), next, error),
			asset: async (id: string, _signal: AbortSignal) =>
				db.one(app.assets.where({ id, libraryId }), {
					tier: ReadTier.LocalFirst,
					firstLoadRemoteWaitMs: 5_000
				})
		} satisfies Omit<ImageCapability, 'request'>
	}
}
