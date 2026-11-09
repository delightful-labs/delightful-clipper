import { createActor, toPromise } from 'xstate'
import { currentLibraryRecords } from './fixture-records.js'
import { articleId } from '../src/lib/capture/source.js'
export async function inspect(urls: string[]) {
	const records = currentLibraryRecords()
	return Promise.all(
		urls.map(async (url) => {
			const id = await articleId(records.articles.libraryId, url)
			const a = await records.articles.read(id)
			return a
				? {
						id: a.id,
						url: a.url,
						contentId: a.contentId,
						operationId: a.operationId,
						failure: a.failure,
						originalSavedAt: a.originalSavedAt
					}
				: null
		})
	)
}
export async function supplied(url: string) {
	const records = currentLibraryRecords()
	const result = await toPromise(
		createActor(records.articles.saveMachine, {
			input: {
				url,
				content: {
					title: 'Supplied clip',
					text: 'Content supplied by a browser clip.',
					html: '<p>Content supplied by a browser clip.</p>',
					finalUrl: url,
					provenance: '{}'
				}
			}
		}).start()
	)
	if (result.kind === 'saved' || result.kind === 'duplicate')
		await Promise.all(result.receipts.map((r) => r.global()))
	return {
		kind: result.kind,
		id: result.operationId,
		ready: 'ready' in result && result.ready === true
	}
}

export async function organize(
	url: string,
	change: { field: 'trashed'; value: boolean },
	waitGlobal = true
) {
	const records = currentLibraryRecords()
	const id = await articleId(records.articles.libraryId, url)
	const result = await toPromise(
		createActor(records.articles.organization.machine, { input: { id, ...change } }).start()
	)
	if (result.kind === 'saved' && waitGlobal)
		await Promise.all(result.receipts.map((receipt) => receipt.global()))
	return result.kind
}
let searchRuntime:
	| {
			actor: import('xstate').ActorRefFrom<
				typeof import('../src/lib/machines/capture/library.js').libraryMachine
			>
			current: () => boolean
	  }
	| undefined
export async function resetSearchSaved() {
	const runtime = searchRuntime
	searchRuntime = undefined
	if (runtime) {
		runtime.actor.send({ type: 'SHUTDOWN' as const })
		await toPromise(runtime.actor)
	}
}
export async function searchSaved(
	query: string,
	view: import('../src/lib/capture/organization.js').LibraryView,
	count: number,
	trashedIds: string[] = []
) {
	const [{ libraryMachine, selectLibraryView }, { openSearchWorker }, { waitFor }] =
		await Promise.all([
			import('../src/lib/machines/capture/library.js'),
			import('../src/lib/search/browser.js'),
			import('xstate')
		])
	const records = currentLibraryRecords()

	if (searchRuntime && !searchRuntime.current()) await resetSearchSaved()
	if (!searchRuntime) {
		const actor = createActor(libraryMachine, {
			input: {
				libraryId: records.articles.libraryId,
				isCurrent: records.isCurrent,
				read: records.readCapabilities,
				subscribe: records.articles.subscribe,
				spawnSave: (spawn, input) => spawn(records.articles.saveMachine, { input }),
				search: {
					libraryId: 'browser-fixture:' + records.articles.libraryId,
					isCurrent: records.isCurrent,
					load: records.searchDocuments,
					observe: records.observeSearch,
					open: openSearchWorker
				},
				worker: (report) => ({
					send: (event) => {
						if (event.type === 'STOP') report({ type: 'BACKGROUND_CLOSED' as const })
					},
					stop: async () => {}
				})
			}
		}).start()
		searchRuntime = { actor, current: records.isCurrent }
	}
	const actor = searchRuntime.actor

	actor.send({ type: 'QUERY' as const, query })
	actor.send({ type: 'FILTER' as const, view, favorites: false })
	await waitFor(
		actor,
		(s) =>
			s.context.rows.length >= count &&
			s.context.rows.every((row) => row.title !== row.url) &&
			trashedIds.every((id) => s.context.rows.some((row) => row.id === id && row.trashed)) &&
			selectLibraryView(s).search.query === query &&
			selectLibraryView(s).search.ids !== undefined,
		{ timeout: 15000 }
	)
	return selectLibraryView(actor.getSnapshot()).rows.map((row) => ({
		id: row.id,
		title: row.title,
		tags: row.tags,
		trashed: row.trashed
	}))
}
