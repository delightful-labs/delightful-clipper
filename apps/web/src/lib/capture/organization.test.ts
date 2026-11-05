import { expect, it } from 'vitest'
import {
	organizationHeads,
	organizationOperationSchema,
	projectOrganization,
	matchesLibraryFilter,
	organizationRequestSchema
} from './organization.js'
import type { OrganizationOperation } from './organization.js'
const id = '00000000-0000-4000-8000-000000000001'
const row = {
	id,
	title: 'Article',
	url: null,
	contentId: id,
	originalSavedAt: '2026-11-04',
	failure: null
}
function op(
	n: number,
	field: 'status' | 'favorite',
	value: string,
	parents: string[] = []
): OrganizationOperation {
	return {
		id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
		articleId: id,
		libraryId: id,
		field,
		value,
		parents
	}
}
it('defaults existing articles to Inbox and preserves independent favorites through every status', () => {
	expect(projectOrganization([row], [])[0]).toMatchObject({ status: 'inbox', favorite: false })
	const favorite = op(1, 'favorite', 'true')
	for (const value of ['inbox', 'later', 'archive'])
		expect(projectOrganization([row], [favorite, op(2, 'status', value)])[0]).toMatchObject({
			status: value,
			favorite: true
		})
	expect(
		projectOrganization(
			[row],
			[favorite, op(2, 'status', 'archive'), op(3, 'favorite', 'false', [favorite.id])]
		)[0]
	).toMatchObject({ status: 'archive', favorite: false })
})
it('uses causal successors before UUID order and UUID order only for concurrent field heads', () => {
	const a = op(9, 'status', 'later'),
		b = op(8, 'status', 'archive'),
		c = op(1, 'status', 'inbox', [a.id, b.id])
	expect(organizationHeads([a, b])).toEqual([b, a])
	for (const operations of [
		[a, b, c],
		[c, b, a],
		[b, c, a]
	])
		expect(projectOrganization([row], operations)[0]?.status).toBe('inbox')
	expect(projectOrganization([row], [b, a])[0]?.status).toBe('later')
})
it('combines the selected status with favorites using AND', () => {
	const [article] = projectOrganization(
		[row],
		[op(1, 'status', 'later'), op(2, 'favorite', 'true')]
	)
	if (!article) throw new Error('Expected article')
	expect(matchesLibraryFilter(article, 'all', true)).toBe(true)
	expect(matchesLibraryFilter(article, 'later', true)).toBe(true)
	expect(matchesLibraryFilter(article, 'inbox', true)).toBe(false)
	expect(matchesLibraryFilter({ ...article, favorite: false }, 'later', true)).toBe(false)
})
it('rejects invalid status, nonboolean favorite and foreign input shapes without coercion', () => {
	for (const request of [
		{ id, field: 'status', value: 'trash' },
		{ id, field: 'favorite', value: 'true' },
		{ id: 'bad', field: 'favorite', value: true }
	])
		expect(organizationRequestSchema.safeParse(request).success).toBe(false)
})
it('retains organization from pending aliases and legacy document rows after content reconciliation', () => {
	const contentId = '00000000-0000-4000-8000-000000000050'
	const aliasId = '00000000-0000-4000-8000-000000000051'
	const alias = { ...row, id: aliasId, contentId }
	const original = { ...row, contentId }
	const status = { ...op(2, 'status', 'archive'), articleId: aliasId }
	const favorite = { ...op(1, 'favorite', 'true'), articleId: contentId }
	expect(projectOrganization([original], [status, favorite], [original, alias])[0]).toMatchObject({
		status: 'archive',
		favorite: true
	})
})
it('decodes exactly one native parent reference and rejects malformed persisted operations', () => {
	const base = { id, libraryId: id, field: 'status', value: 'later', parents: '[]' }
	for (const refs of [
		{ articleId: id, documentId: null },
		{ articleId: null, documentId: id }
	])
		expect(organizationOperationSchema.parse({ ...base, ...refs }).articleId).toBe(id)
	for (const refs of [
		{ articleId: null, documentId: null },
		{ articleId: id, documentId: id }
	])
		expect(organizationOperationSchema.safeParse({ ...base, ...refs }).success).toBe(false)
	expect(
		organizationOperationSchema.safeParse({
			...base,
			articleId: id,
			documentId: null,
			parents: '["bad-id"]'
		}).success
	).toBe(false)
})
