import { faker } from '@faker-js/faker/locale/en'
import { articleId } from '../capture/source.js'
import { articleSchema } from '../capture/article-schema.js'
import { articleStatuses } from '../capture/organization.js'
import { tagKey, tagNameSchema } from '../capture/tags.js'
import { prepareSave } from '../storage/prepare.js'
export const FAKE_ARTICLE_COUNT = 24
/** Payload construction only, matching Finance's English locale and stable scoped identities. */
export async function prepareFakeData(libraryId: string) {
	const tags = Array.from({ length: 3 }, () => tagNameSchema.parse(faker.word.noun()))
	return Promise.all(
		Array.from({ length: FAKE_ARTICLE_COUNT }, async (_, index) => {
			const url = `https://example.invalid/clipper-samples/v1/${index}`
			const [id, operationId, statusId, favoriteId, trashId, tagId] = await Promise.all(
				['', '/snapshot', '/status', '/favorite', '/trash', '/tag'].map((suffix) =>
					articleId(libraryId, url + suffix)
				)
			)
			if (!id || !operationId || !statusId || !favoriteId || !trashId || !tagId)
				throw new Error('Missing sample identity')
			const title = faker.lorem.sentence({ min: 4, max: 9 })
			const text = faker.lorem.paragraphs(5)
			const savedAt = faker.date.recent({ days: 90 }).toISOString()
			const content = await prepareSave(libraryId, {
				operationId,
				articleId: id,
				title,
				text,
				bytes: new TextEncoder().encode(text),
				mediaType: 'text/plain',
				source: {
					submittedUrl: url,
					finalUrl: url,
					provenance: JSON.stringify({ source: 'fake-data', version: 1 })
				}
			})
			content.intent.createdAt = savedAt
			content.document.originalSavedAt = savedAt
			const article = articleSchema.parse({
				id,
				libraryId,
				url,
				originalSavedAt: savedAt,
				contentId: operationId,
				operationId,
				failure: null
			})
			const parent = { libraryId, articleId: id, documentId: null, parents: '[]' }
			const name = tags[index % tags.length]
			const status = articleStatuses[index % articleStatuses.length]
			if (!name || !status) throw new Error('Missing sample classification')
			return {
				content,
				article,
				properties: [
					{ id: statusId, ...parent, field: 'status', value: status },
					{ id: favoriteId, ...parent, field: 'favorite', value: String(index % 4 === 0) },
					{ id: trashId, ...parent, field: 'trashed', value: String(index % 10 === 9) }
				],
				tag: { id: tagId, ...parent, key: tagKey(name), name, assigned: true }
			}
		})
	)
}
export type FakeDataPlan = Awaited<ReturnType<typeof prepareFakeData>>
