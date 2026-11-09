import { createActor, toPromise } from 'xstate'
import { currentLibraryRecords } from './fixture-records.js'
import type { ArticleImage } from '../src/lib/images/schema.js'
export async function seedImages(urls: string[]) {
	const records = currentLibraryRecords(),
		url = 'https://example.com/images-' + crypto.randomUUID()
	const html = `<p>Saved text stays readable while images load.</p>${urls.map((url, index) => `<figure><img data-clipper-image="${encodeURIComponent(url)}" alt="Saved image ${index + 1}" src="https://images.example/never-load-from-reader.png"><figcaption>Figure ${index + 1}</figcaption></figure>`).join('')}<p>Article ending.</p>`
	const result = await toPromise(
		createActor(records.articles.saveMachine, {
			input: {
				url,
				content: {
					title: 'Offline image fixture',
					text: 'Saved text stays readable while images load. Article ending.',
					html,
					finalUrl: url,
					provenance: '{}'
				}
			}
		}).start()
	)
	if (result.kind !== 'saved') throw new Error('Expected image text fixture')
	await Promise.all(result.receipts.map((receipt) => receipt.global()))
	return result.operationId
}
export async function imageRows() {
	const records = currentLibraryRecords()
	let dispose: (() => void) | undefined
	try {
		return await new Promise<ArticleImage[]>((resolve, reject) => {
			dispose = records.images.capability.subscribe(resolve, () =>
				reject(new Error('Image fixture unavailable'))
			)
		})
	} finally {
		dispose?.()
	}
}
