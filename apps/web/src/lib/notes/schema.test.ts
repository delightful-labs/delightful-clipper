import { expect, it } from 'vitest'
import {
	acknowledgesArticleNoteDraft,
	articleNoteDraftSchema,
	articleNoteRevisionSchema,
	noteTextSchema,
	projectArticleNote
} from './schema.js'
const target = { libraryId: crypto.randomUUID(), articleId: crypto.randomUUID() }
function revision(text: string, parents: string[] = []) {
	return articleNoteRevisionSchema.parse({
		...target,
		id: crypto.randomUUID(),
		text,
		parents,
		editedAt: '2026-11-06T12:00:00.000Z'
	})
}

it('preserves literal Unicode, whitespace, links and empty text with a UTF-8 byte bound', () => {
	for (const text of ['', '  \n', '<b>literal</b> https://example.com 😀 e\u0301'])
		expect(noteTextSchema.parse(text)).toBe(text)
	expect(noteTextSchema.safeParse('😀'.repeat(65536)).success).toBe(true)
	expect(noteTextSchema.safeParse('😀'.repeat(65537)).success).toBe(false)
	expect(noteTextSchema.safeParse('a'.repeat(262145)).success).toBe(false)
})

it('retains concurrent text and clears only causally observed revisions', () => {
	const base = revision('base')
	const a = revision('offline device A', [base.id])
	const b = revision('offline device B', [base.id])
	const cleared = revision('', [a.id])
	const rows = [base, a, b, cleared]
	const projection = projectArticleNote(target, rows)
	expect(projection.conflicted).toBe(true)
	expect(projection.versions.map((version) => version.text).sort()).toEqual([
		'',
		'offline device B'
	])
	expect(projectArticleNote(target, [...rows].reverse())).toEqual(projection)
	const reconciled = revision(
		'chosen text',
		projection.heads.map((head) => head.id)
	)
	expect(projectArticleNote(target, [...rows, reconciled]).versions).toEqual([
		{ text: 'chosen text', revisions: [reconciled] }
	])
})

it('groups identical concurrent text while retaining both causal heads', () => {
	const a = revision('same'),
		b = revision('same')
	const projection = projectArticleNote(target, [a, b])
	expect(projection.conflicted).toBe(false)
	expect(projection.heads).toHaveLength(2)
	expect(projection.versions).toHaveLength(1)
})

it('isolates parents and accounts before calculating causal dominance', () => {
	const a = revision('private')
	const otherArticle = { ...revision('other', [a.id]), articleId: crypto.randomUUID() }
	const otherLibrary = { ...revision('other account', [a.id]), libraryId: crypto.randomUUID() }
	expect(projectArticleNote(target, [a, otherArticle, otherLibrary]).heads).toEqual([a])
	expect(projectArticleNote(target, []).versions).toEqual([])
})

it('preserves a legacy document note across URL article aliases without merging a foreign library', () => {
	const legacy = revision('legacy')
	const articleId = crypto.randomUUID()
	const currentTarget = { ...target, articleId }
	const modern = { ...revision('modern', [legacy.id]), articleId }
	const foreign = { ...revision('foreign', [modern.id]), libraryId: crypto.randomUUID(), articleId }
	const aliases = new Set([target.articleId, articleId])
	expect(projectArticleNote(currentTarget, [legacy, modern, foreign], aliases).heads).toEqual([
		modern
	])
})

it('rejects delayed or mismatched acknowledgments without clearing a newer draft', () => {
	const draft = articleNoteDraftSchema.parse({
		...target,
		sequence: 2,
		text: 'newer',
		baseRevisionIds: [crypto.randomUUID()]
	})
	expect(acknowledgesArticleNoteDraft(draft, { ...draft })).toBe(true)
	for (const change of [
		{ sequence: 1 },
		{ text: 'older' },
		{ articleId: crypto.randomUUID() },
		{ libraryId: crypto.randomUUID() },
		{ baseRevisionIds: [] }
	])
		expect(acknowledgesArticleNoteDraft(draft, { ...draft, ...change })).toBe(false)
	expect(articleNoteDraftSchema.safeParse({ ...draft, sequence: -1 }).success).toBe(false)
	expect(articleNoteDraftSchema.safeParse({ ...draft, sequence: 1.5 }).success).toBe(false)
})
