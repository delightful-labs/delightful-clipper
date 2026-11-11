/// <reference lib="webworker" />
export {}
declare const self: SharedWorkerGlobalScope
self.onconnect = ({ ports }) => {
	const port = ports[0]
	if (!port) throw new Error('Missing broker fixture port')
	port.onmessage = (event) => port.postMessage(event.data)
	port.start()
}
