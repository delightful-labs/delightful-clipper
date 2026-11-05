import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createCaptureReadMachine } from './background-machine.js'
const id = '77777777-7777-4777-8777-777777777777'
const capture = {
	version: 1 as const,
	id,
	tabId: 7,
	documentId: 'original-document',
	url: 'https://example.com/article',
	phase: 'ready' as const
}
const source = { url: capture.url, base: capture.url, html: '<html><body>Text</body></html>' }
function fixture(
	options: {
		sender?: chrome.runtime.MessageSender
		stored?: unknown
		tabUrl?: string
		output?: unknown
		fail?: boolean
	} = {}
) {
	const read = vi.fn(async () => options.stored ?? capture)
	const tab = vi.fn(async () => ({
		id: 7,
		url: options.tabUrl ?? capture.url,
		index: 0,
		pinned: false,
		highlighted: true,
		windowId: 1,
		active: true,
		incognito: false,
		selected: true,
		discarded: false,
		autoDiscardable: true,
		groupId: -1,
		frozen: false,
		lastAccessed: 0
	}))
	const execute = vi.fn(async () => {
		if (options.fail) throw new Error('document no longer exists')
		return options.output ?? source
	})
	const actor = createActor(
		createCaptureReadMachine({
			id: 'extension-id',
			page: 'chrome-extension://extension-id/index.html',
			read,
			tab,
			capture: execute
		}),
		{
			input: {
				message: { type: 'CAPTURE', id },
				sender: options.sender ?? {
					id: 'extension-id',
					url: 'chrome-extension://extension-id/index.html',
					frameId: 0
				}
			}
		}
	).start()
	return { actor, read, tab, execute }
}
it('rejects page/foreign senders before reading any private capture metadata', async () => {
	const f = fixture({ sender: { id: 'other', url: 'https://example.com/' } })
	expect(await toPromise(f.actor)).toEqual({ error: 'captureFailed' })
	expect(f.read).not.toHaveBeenCalled()
})
it('targets the recorded document and returns only validated capture data', async () => {
	const f = fixture()
	expect(await toPromise(f.actor)).toEqual({ capture, source })
	expect(f.execute).toHaveBeenCalledWith(capture)
})
it('does not recapture or replay an issued operation after a background restart', async () => {
	const stored = { ...capture, phase: 'issued', accountId: crypto.randomUUID() }
	const f = fixture({ stored })
	expect(await toPromise(f.actor)).toEqual({ capture: stored })
	expect(f.tab).not.toHaveBeenCalled()
	expect(f.execute).not.toHaveBeenCalled()
})
it('rejects a mismatched stored operation ID', async () => {
	const f = fixture({ stored: { ...capture, id: crypto.randomUUID() } })
	expect(await toPromise(f.actor)).toEqual({ error: 'captureFailed' })
	expect(f.tab).not.toHaveBeenCalled()
})
it.each(['https://example.com/changed', 'chrome://settings'])(
	'falls back to the original URL after navigation to %s',
	async (tabUrl) => {
		const f = fixture({ tabUrl })
		expect(await toPromise(f.actor)).toEqual({ capture })
		expect(f.execute).not.toHaveBeenCalled()
	}
)
it('retains only the original URL when the same-URL document was replaced', async () => {
	const f = fixture({ fail: true })
	expect(await toPromise(f.actor)).toEqual({ capture })
})
it('rejects mismatched rendered data after the final document check', async () => {
	const f = fixture({ output: { ...source, url: 'https://example.com/other' } })
	expect(await toPromise(f.actor)).toEqual({ capture })
})
