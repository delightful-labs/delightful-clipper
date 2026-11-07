import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createNotificationMachine } from './notification-machine.js'
const id = '77777777-7777-4777-8777-777777777777'
const capture = {
	version: 1 as const,
	id,
	tabId: 7,
	documentId: 'original-document',
	url: 'https://example.com/article',
	phase: 'ready' as const
}
const feedback = { text: 'Saving article', variant: 'info' as const }
const sender = {
	id: 'extension-id',
	url: 'chrome-extension://extension-id/runtime.html',
	frameId: 0
}
const waiting = { type: 'WAITING', id, revision: 4, message: feedback }
const progress = {
	type: 'PROGRESS',
	capture,
	revision: 5,
	message: feedback,
	articleId: crypto.randomUUID()
}
function fixture(
	message: unknown,
	options: {
		sender?: chrome.runtime.MessageSender
		stored?: unknown
		readError?: boolean
		showError?: boolean
		release?: Promise<void>
	} = {}
) {
	const read = vi.fn(async () => {
		if (options.readError) throw new Error('unavailable')
		return Object.hasOwn(options, 'stored') ? options.stored : capture
	})
	const show = vi.fn(async () => {
		await options.release
		if (options.showError) throw new Error('document closed')
	})
	const actor = createActor(
		createNotificationMachine({
			id: 'extension-id',
			page: 'chrome-extension://extension-id/runtime.html',
			read,
			show
		}),
		{ input: { message, sender: options.sender ?? sender } }
	).start()
	return { actor, read, show, result: toPromise(actor) }
}
it('reads and validates the exact waiting capture before displaying its message', async () => {
	const f = fixture(waiting)
	expect(await f.result).toEqual({ accepted: true })
	expect(f.read).toHaveBeenCalledExactlyOnceWith(id)
	expect(f.show).toHaveBeenCalledExactlyOnceWith({ capture, message: feedback, revision: 4 })
})
it('shows validated progress directly and preserves the article destination and revision', async () => {
	const f = fixture(progress)
	expect(await f.result).toEqual({ accepted: true })
	expect(f.read).not.toHaveBeenCalled()
	expect(f.show).toHaveBeenCalledExactlyOnceWith({
		capture,
		message: feedback,
		revision: 5,
		articleId: progress.articleId
	})
})
it.each([
	{ id: 'foreign', url: sender.url },
	{ ...sender, frameId: 1 },
	{ ...sender, url: 'https://example.com/' },
	{ ...sender, url: 'chrome-extension://extension-id/index.html' }
])(
	'rejects an untrusted notification sender before reading or displaying: $url',
	async (untrusted) => {
		const f = fixture(waiting, { sender: untrusted })
		expect(await f.result).toEqual({ accepted: false })
		expect(f.read).not.toHaveBeenCalled()
		expect(f.show).not.toHaveBeenCalled()
	}
)
it.each([
	{ ...waiting, revision: -1 },
	{ ...progress, articleId: 'invalid' },
	{ type: 'WAITING', id }
])('rejects malformed notification input', async (message) => {
	const f = fixture(message)
	expect(await f.result).toEqual({ accepted: false })
	expect(f.read).not.toHaveBeenCalled()
	expect(f.show).not.toHaveBeenCalled()
})
it.each([undefined, null, { ...capture, id: crypto.randomUUID() }])(
	'does not display a missing or mismatched stored capture',
	async (stored) => {
		const f = fixture(waiting, { stored })
		expect(await f.result).toEqual({ accepted: false })
		expect(f.show).not.toHaveBeenCalled()
	}
)
it('does not acknowledge progress before the display operation completes', async () => {
	const release = Promise.withResolvers<void>()
	const f = fixture(progress, { release: release.promise })
	expect(f.actor.getSnapshot().status).toBe('active')
	expect(f.actor.getSnapshot().context.accepted).toBe(false)
	release.resolve()
	expect(await f.result).toEqual({ accepted: true })
})
it.each([{ readError: true }, { showError: true }])(
	'returns a rejected acknowledgment when storage/display fails',
	async (options) => {
		const f = fixture(waiting, options)
		expect(await f.result).toEqual({ accepted: false })
	}
)
