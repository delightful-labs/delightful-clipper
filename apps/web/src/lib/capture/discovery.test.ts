import { expect, it } from 'vitest'
import { tagNameSchema, tagKey, projectTags, tagOperationSchema } from './tags.js'
import type { TagOperation } from './tags.js'
import { projectOrganization, matchesLibraryFilter } from './organization.js'
import type { LibraryArticle } from '../contracts/articles.js'
const article = crypto.randomUUID(),
	libraryId = crypto.randomUUID()
const row: LibraryArticle = {
	id: article,
	title: 'Saved',
	url: 'https://example.com',
	contentId: null,
	originalSavedAt: '2026-01-01',
	failure: null
}
function tag(name: string, assigned = true, parents: string[] = []): TagOperation {
	return {
		id: crypto.randomUUID(),
		libraryId,
		articleId: article,
		field: 'tag',
		value: name,
		name,
		key: tagKey(name),
		assigned,
		parents
	}
}
it('version-folds Unicode names while retaining accents and punctuation', () => {
	expect(tagKey(' Straße ')).toBe(tagKey('STRASSE'))
	expect(tagKey('ΟΣ')).toBe(tagKey('ος'))
	expect(tagKey('Cafe\u0301')).toBe(tagKey('Café'))
	expect(tagKey('cafe')).not.toBe(tagKey('café'))
	expect(tagKey('a-b')).not.toBe(tagKey('ab'))
	expect(tagNameSchema.parse('  Café ')).toBe('Café')
	expect(tagNameSchema.safeParse(' ').success).toBe(false)
	expect(tagNameSchema.safeParse('🦊'.repeat(64)).success).toBe(true)
	expect(tagNameSchema.safeParse('🦊'.repeat(65)).success).toBe(false)
})
it('merges concurrent spellings into one vocabulary and keeps independent tag memberships', () => {
	const a = tag('Straße'),
		b = tag('STRASSE'),
		c = tag('Reading')
	const rows = projectTags([row], [a, b, c])
	expect(rows[0]?.tags).toHaveLength(2)
	const remove = tag('strasse', false, [a.id, b.id])
	const next = projectTags([row], [a, b, c, remove])
	expect(next[0]?.tags?.map((t) => t.key)).toEqual([tagKey('Reading')])
	expect(next[0]?.tagVocabulary).toHaveLength(2)
})
it('validates tag identity, desired membership and exactly one native parent', () => {
	const a = tag('Reading')
	const raw = { ...a, articleId: article, documentId: null, parents: '[]' }
	expect(tagOperationSchema.safeParse(raw).success).toBe(true)
	expect(tagOperationSchema.safeParse({ ...raw, key: 'wrong' }).success).toBe(false)
	expect(tagOperationSchema.safeParse({ ...raw, documentId: crypto.randomUUID() }).success).toBe(
		false
	)
})
it('Trash is independent and restores previous organization without content replacement', () => {
	const status = {
		id: crypto.randomUUID(),
		libraryId,
		articleId: article,
		field: 'status' as const,
		value: 'later',
		parents: []
	}
	const favorite = { ...status, id: crypto.randomUUID(), field: 'favorite' as const, value: 'true' }
	const trash = { ...status, id: crypto.randomUUID(), field: 'trashed' as const, value: 'true' }
	const trashed = projectOrganization([row], [status, favorite, trash])[0]!
	expect(matchesLibraryFilter(trashed, 'all', false)).toBe(false)
	expect(matchesLibraryFilter(trashed, 'trash', true)).toBe(true)
	const restore = { ...trash, id: crypto.randomUUID(), value: 'false', parents: [trash.id] }
	const restored = projectOrganization([row], [status, favorite, trash, restore])[0]!
	expect(restored).toMatchObject({
		id: article,
		status: 'later',
		favorite: true,
		trashed: false,
		contentId: null
	})
})
