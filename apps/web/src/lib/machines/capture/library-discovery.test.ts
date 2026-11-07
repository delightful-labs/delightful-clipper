import { expect, it } from 'vitest'
import { createActor, toPromise, waitFor } from 'xstate'
import {
	libraryMachine,
	selectLibraryView,
	selectLibraryCaptureView,
	selectLibraryReaderView,
	selectLibraryReaderExperience
} from './library.js'
import { testLibraryCapability } from './library.test-support.js'
import { createSearchWorkerMachine } from '../../search/worker-machine.js'
import { tagKey } from '../../capture/tags.js'
import type { LibraryArticle } from '../../contracts/articles.js'
const a = crypto.randomUUID(),
	b = crypto.randomUUID(),
	c = crypto.randomUUID()
const candidate = {
	id: a,
	title: 'Saved',
	text: '',
	html: '',
	finalUrl: 'https://example.com',
	submittedUrl: 'https://example.com',
	provenance: '{}',
	imagesMissing: false
}
const tag = { key: tagKey('Reading'), name: 'Reading' }
const rows: LibraryArticle[] = [
	{
		id: a,
		title: 'First article',
		url: 'https://example.com/one',
		contentId: a,
		originalSavedAt: '2026-01-01',
		failure: null,
		status: 'inbox',
		favorite: true,
		tags: [tag]
	},
	{
		id: b,
		title: 'Second article',
		url: 'https://example.com/two',
		contentId: b,
		originalSavedAt: '2026-01-02',
		failure: null,
		status: 'later',
		favorite: false,
		tags: [tag]
	},
	{
		id: c,
		title: 'Third article',
		url: 'https://example.com/three',
		contentId: c,
		originalSavedAt: '2026-01-03',
		failure: null,
		status: 'later',
		favorite: true,
		trashed: true,
		tags: [tag]
	}
]
it('combines real indexed text matches with status, Favorites, tag AND filters and explicit Trash scope', async () => {
	let dirty = () => {}
	const text = new Map<string, string>([
		[a, 'Needle in saved body'],
		[b, 'Needle in another body'],
		[c, 'Needle in Trash']
	])
	const actor = createActor(libraryMachine, {
		input: {
			...testLibraryCapability(candidate),
			search: {
				libraryId: 'isolated/account',
				isCurrent: () => true,
				load: async (rows) =>
					rows.map((row) => ({
						id: row.id,
						title: row.title,
						url: row.url ?? '',
						text: text.get(row.id) ?? '',
						tags: (row.tags ?? []).map((tag) => tag.name).join(' '),
						originalSavedAt: row.originalSavedAt
					})),
				observe: (next) => {
					dirty = next
					return () => {
						dirty = () => {}
					}
				},
				open: (report) => {
					const worker = createActor(
						createSearchWorkerMachine({
							read: async () => undefined,
							write: async () => {},
							report
						})
					).start()
					return {
						post: (event) => worker.send(event),
						dispose: () => {
							worker.send({ type: 'STOP' })
							worker.stop()
						}
					}
				}
			}
		}
	}).start()
	actor.send({ type: 'ROWS', rows })
	actor.send({ type: 'QUERY', query: 'needle' })
	actor.send({ type: 'SEARCH_OPEN' })
	await waitFor(actor, (s) => selectLibraryView(s).search.ids !== undefined)
	expect(
		selectLibraryView(actor.getSnapshot())
			.rows.map((row) => row.id)
			.sort()
	).toEqual([a, b].sort())
	actor.send({ type: 'TAG_FILTER', keys: [tag.key] })
	actor.send({ type: 'FILTER', view: 'later', favorites: true })
	expect(selectLibraryView(actor.getSnapshot()).rows).toEqual([])
	actor.send({ type: 'FILTER', view: 'trash', favorites: true })
	expect(selectLibraryView(actor.getSnapshot()).rows.map((row) => row.id)).toEqual([c])
	actor.send({ type: 'FILTER', view: 'all', favorites: false })
	text.set(a, 'Body replaced in fixture without matching term')
	dirty()
	await waitFor(actor, (s) => selectLibraryView(s).search.ids !== undefined)
	expect(selectLibraryView(actor.getSnapshot()).rows.map((row) => row.id)).toEqual([b])
	actor.send({ type: 'QUERY', query: 'x'.repeat(513) })
	expect(actor.getSnapshot().context.query).toBe('needle')
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
	expect(actor.getSnapshot().context.query).toBe('')
	expect(actor.getSnapshot().context.selectedTags).toEqual([])
	expect(selectLibraryView(actor.getSnapshot()).search.enabled).toBe(false)
})
it('offers explicit restore for a trashed duplicate instead of implicitly restoring or opening it', async () => {
	const actor = createActor(libraryMachine, { input: testLibraryCapability(candidate) }).start()
	actor.send({ type: 'ROWS', rows: [{ ...rows[0]!, trashed: true }] })
	actor.send({ type: 'ADD', url: candidate.finalUrl })
	await waitFor(actor, (s) => s.matches({ running: { capture: 'saved' } }))
	expect(selectLibraryView(actor.getSnapshot()).restoreCaptureId).toBe(a)
	expect(selectLibraryView(actor.getSnapshot()).canOpenCapture).toBe(false)
	expect(actor.getSnapshot().context.rows[0]?.trashed).toBe(true)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})

it('reuses list projections for unrelated updates and keeps narrow views scoped', async () => {
	let current = true
	const actor = createActor(libraryMachine, {
		input: { ...testLibraryCapability(candidate), isCurrent: () => current }
	}).start()
	actor.send({ type: 'ROWS', rows })
	const first = selectLibraryView(actor.getSnapshot())
	actor.send({
		type: 'BACKGROUND_STATUS',
		id: 'other',
		message: { text: 'Background work', variant: 'info' },
		cancelable: false
	})
	const next = selectLibraryView(actor.getSnapshot())
	expect(next.rows).toBe(first.rows)
	expect(next.readable).toBe(first.readable)
	expect(selectLibraryCaptureView(actor.getSnapshot())).not.toHaveProperty('rows')
	expect(selectLibraryReaderView(actor.getSnapshot())).not.toHaveProperty('rows')
	current = false
	expect(selectLibraryView(actor.getSnapshot()).rows).toEqual([])
	expect(selectLibraryReaderExperience(actor.getSnapshot()).enabled).toBe(false)
	expect(selectLibraryCaptureView(actor.getSnapshot()).canOrganize).toBe(false)
	actor.send({ type: 'SHUTDOWN' })
	await toPromise(actor)
})
