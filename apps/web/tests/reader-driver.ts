import { createActor, toPromise } from 'xstate'
import { currentLibraryRecords } from './fixture-records.js'
import { projectReaderState } from '../src/lib/reader/schema.js'
export async function seedReader(url: string, paragraphCount = 70) {
	const records = currentLibraryRecords()
	const paragraphs = Array.from(
		{ length: paragraphCount },
		(_, index) =>
			`<p>Paragraph ${index + 1}. ${'Readable café 🦊 text with reliable context. '.repeat(14)}</p>`
	)
	const html = `<h3 id="start">Beginning</h3><p>Opening text with <a href="#fn1">Citation</a>.</p>${paragraphs.slice(0, 35).join('')}<h3 id="middle">Middle chapter</h3>${paragraphs.slice(35).join('')}<h3 id="end">Ending</h3><ol><li id="fn1">A saved reader footnote.</li></ol>`
	const text = html.replace(/<[^>]*>/g, ' ')
	const result = await toPromise(
		createActor(records.articles.saveMachine, {
			input: {
				url,
				content: { title: 'Reader experience fixture', text, html, finalUrl: url, provenance: '{}' }
			}
		}).start()
	)
	if (result.kind !== 'saved' && result.kind !== 'duplicate')
		throw new Error('Expected saved reader fixture')
	await Promise.all(result.receipts.map((receipt) => receipt.global()))
	return result.operationId
}
export async function readingState() {
	const records = currentLibraryRecords()
	let dispose: (() => void) | undefined
	try {
		const rows = await new Promise<import('../src/lib/reader/schema.js').ReaderOperation[]>(
			(resolve, reject) => {
				dispose = records.reader.capability.subscribe(resolve, () =>
					reject(new Error('Reading fixture unavailable'))
				)
			}
		)
		return projectReaderState(rows)
	} finally {
		dispose?.()
	}
}
