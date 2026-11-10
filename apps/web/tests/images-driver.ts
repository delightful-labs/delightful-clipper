import { currentLibraryRecords } from './fixture-records.js'
import type { ArticleImage } from '../src/lib/images/schema.js'
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
