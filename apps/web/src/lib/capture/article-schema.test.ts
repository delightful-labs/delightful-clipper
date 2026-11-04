import { expect, it } from 'vitest'
import { articleRecord } from './articles.js'
const id = 'abcdef01-2345-6789-abcd-ef0123456789'
const article = {
	id,
	libraryId: 'library',
	url: 'https://example.com/#fragment',
	originalSavedAt: '2026-11-04',
	contentId: null,
	operationId: null,
	failure: null
}
it('validates native article shape without changing stored URL or time representation', () => {
	expect(articleRecord(article, 'library')).toEqual(article)
})
it.each([
	null,
	[],
	{ ...article, id: id.toUpperCase() },
	{ ...article, operationId: id.toUpperCase() },
	{ ...article, originalSavedAt: 'not a date' },
	{ ...article, failure: 'a'.repeat(101) }
])('rejects malformed native articles through the existing record error', (value) => {
	expect(() => articleRecord(value, 'library')).toThrow('invalidRecord')
})
it('retains ownership and URL policy checks outside structural parsing', () => {
	expect(() => articleRecord(article, 'other-library')).toThrow('invalidRecord')
	expect(() => articleRecord({ ...article, url: 'file:///private' }, 'library')).toThrow(
		'invalidUrl'
	)
})
