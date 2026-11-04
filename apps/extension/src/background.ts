import { createLaunchMachine } from './launch-machine.js'
import { createActor, toPromise } from 'xstate'
import { captureKey, captureSchema } from './protocol.js'
import { serializePage } from './serialize.js'
import { createCaptureReadMachine } from './background-machine.js'
chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
const reader = createCaptureReadMachine({
	id: chrome.runtime.id,
	page: chrome.runtime.getURL('index.html'),
	read: async (id) => (await chrome.storage.local.get(captureKey(id)))[captureKey(id)],
	tab: (id) => chrome.tabs.get(id),
	capture: async (capture) =>
		(
			await chrome.scripting.executeScript({
				target: { tabId: capture.tabId, documentIds: [capture.documentId] },
				func: serializePage
			})
		)[0]?.result
})
chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
	const actor = createActor(reader, { input: { message, sender } })
	void toPromise(actor)
		.then(reply, () => reply({ error: 'captureFailed' }))
		.finally(() => actor.stop())
	actor.start()
	return true
})
const launcher = createActor(
	createLaunchMachine({
		inspect: async (id) =>
			(
				await chrome.scripting.executeScript({ target: { tabId: id }, func: () => location.href })
			)[0],
		pending: async () =>
			Object.values(await chrome.storage.local.get(null)).flatMap((value) => {
				const parsed = captureSchema.safeParse(value)
				return parsed.success ? [parsed.data] : []
			}),
		persist: (capture) => chrome.storage.local.set({ [captureKey(capture.id)]: capture }),
		open: (id) => chrome.tabs.create({ url: chrome.runtime.getURL(`index.html#${id}`) }),
		id: () => crypto.randomUUID()
	})
).start()
chrome.action.onClicked.addListener((tab) => launcher.send({ type: 'CLIP', tab }))
