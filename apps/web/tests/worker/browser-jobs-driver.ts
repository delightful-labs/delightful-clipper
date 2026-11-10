export async function qualifyBrowserJob(
	mode: 'image' | 'extract',
	fault: 'none' | 'post' | 'cancel'
) {
	const worker = new Worker(new URL('./browser-jobs.worker.ts', import.meta.url), {
		type: 'module'
	})
	try {
		return await new Promise((resolve, reject) => {
			worker.onmessage = ({ data }) => resolve(data)
			worker.onerror = () => reject(new Error('Native job qualification failed'))
			worker.postMessage({ mode, fault })
		})
	} finally {
		worker.terminate()
	}
}
