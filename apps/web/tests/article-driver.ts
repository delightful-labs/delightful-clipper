import { createActor, toPromise } from 'xstate'
import { currentLibraryRecords } from '../src/lib/backend/jazz/account.js'
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
