/// <reference lib="webworker" />
import { extractRenderedSource } from './extract.js'
self.onmessage = (event: MessageEvent<unknown>) => {
	try {
		self.postMessage({ content: extractRenderedSource(event.data) })
	} catch {
		self.postMessage({ error: 'captureFailed' })
	}
	self.close()
}
