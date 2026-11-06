import { ReadTier } from 'jazz-tools'
import type { Db, WriteHandle } from 'jazz-tools'
import { createWorkspaceCreationTransaction } from 'delightful-local-first/workspace/creation/workflow'
import type { ImageCapability, ImageSpawner } from '../../contracts/images.js'
import type { ImageWrite, ArticleImage } from '../../images/schema.js'
import { imageRowSchema, canWriteImage, processedImageSchema } from '../../images/schema.js'
import { z } from 'zod'
import type { SyncReceipt } from '../../contracts/storage.js'
import { transactionLifecycle, transactionReceipt } from './transaction.js'
import type { TransactionResource } from './transaction.js'
import { app } from './schema.js'
export function createImageRecords(
	db: Pick<Db, 'one' | 'subscribe' | 'beginTransaction'>,
	libraryId: string,
	isCurrent: () => boolean
) {
	type Resource = TransactionResource & { hash?: string }
	type Rows = { image: ArticleImage | null; intent: unknown }
	const readLocal = async (resource: TransactionResource, attempt: { draft: ImageWrite }) => {
		const image = await resource.tx.one(
			app.articleImages.where({ id: attempt.draft.image.id, libraryId }),
			{ tier: ReadTier.LocalFirst }
		)
		const intent = await resource.tx.one(
			app.storageOperations.where({ id: attempt.draft.image.id, libraryId }),
			{ tier: ReadTier.LocalFirst }
		)
		return { image: image ? imageRowSchema.parse(image) : null, intent }
	}
	const assess = (rows: Rows, attempt: { draft: ImageWrite }) =>
		canWriteImage(
			rows.image,
			attempt.draft,
			attempt.draft.kind === 'ready' ? rows.intent : undefined
		)
			? { outcome: 'eligible' as const }
			: { outcome: 'blocked' as const, reason: 'Image publication unavailable' }
	const ready = createWorkspaceCreationTransaction<
		ImageWrite,
		Resource,
		Rows,
		SyncReceipt,
		WriteHandle
	>({
		...transactionLifecycle(db, isCurrent),
		readLocal: async (resource, attempt) => {
			if (attempt.draft.kind !== 'ready') throw new Error('Invalid image publication')
			const result = processedImageSchema.parse(attempt.draft.result)
			const digest = new Uint8Array(
				await crypto.subtle.digest('SHA-256', new Uint8Array(result.bytes))
			)
			resource.hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, '0')).join('')
			return readLocal(resource, attempt)
		},
		assess,
		stage: (resource, attempt) => {
			if (attempt.draft.kind !== 'ready') throw new Error('Invalid image publication')
			const { image, result } = attempt.draft
			resource.tx.insert(
				app.storageOperations,
				{ libraryId, payloadHash: resource.hash!, createdAt: new Date().toISOString() },
				{ id: image.id }
			)
			resource.tx.insert(
				app.assets,
				{ libraryId, operationId: image.id, mediaType: result.mediaType, payload: result.bytes },
				{ id: image.id }
			)
			resource.tx.update(app.articleImages, image.id, {
				status: 'ready',
				assetId: image.id,
				retryable: false
			})
			return transactionReceipt(resource)
		}
	})
	const failure = createWorkspaceCreationTransaction<
		ImageWrite,
		TransactionResource,
		Rows,
		SyncReceipt,
		WriteHandle
	>({
		...transactionLifecycle(db, isCurrent),
		readLocal,
		assess,
		stage: (resource, { draft }) => {
			if (draft.kind !== 'failed') throw new Error('Invalid image failure')
			resource.tx.update(app.articleImages, draft.image.id, {
				status: 'failed',
				assetId: null,
				retryable: draft.retryable
			})
			return transactionReceipt(resource)
		}
	})
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
	const spawnReady = (spawn: ImageSpawner, draft: ImageWrite) =>
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
	const spawnFailure = (spawn: ImageSpawner, draft: ImageWrite) => {
		const operationId = crypto.randomUUID()
		return spawn(failure, {
			input: {
				attempt: { operationId, workspaceId: operationId, membershipId: operationId, draft }
			}
		})
	}
	return {
		ready,
		failure,
		capability: {
			isCurrent,
			hasIntent: async (id: string, _signal: AbortSignal) =>
				!!(await db.one(app.storageOperations.where({ id, libraryId }), {
					tier: ReadTier.LocalFirstUnlessEmpty
				})),
			spawnReady,
			spawnFailure,
			subscribe: (next, error) => subscribe(app.articleImages.where({ libraryId }), next, error),
			subscribeImage: (documentId, sourceUrl, next, error) =>
				subscribe(app.articleImages.where({ libraryId, documentId, sourceUrl }), next, error),
			asset: async (id: string, _signal: AbortSignal) =>
				db.one(app.assets.where({ id, libraryId }), { tier: ReadTier.LocalFirstUnlessEmpty })
		} satisfies Omit<ImageCapability, 'request'>
	}
}
