import { createLaunchMachine } from './launch-machine.js'
import { createActor, toPromise } from 'xstate'
import { z } from 'zod'
import {
	captureKey,
	captureSchema,
	messageSchema,
	progressSchema,
	referenceMessageSchema,
	trustedSender,
	waitingSchema,
	captureFor,
	accountChangedSchema
} from './protocol.js'
import type { Capture } from './protocol.js'
import { serializePage } from './serialize.js'
import { createCaptureReadMachine } from './background-machine.js'
import { createReferenceMachine } from './reference-machine.js'
import { renderBar } from './bar.js'
import { action, t } from '../../web/src/lib/localization/index.js'
import type { WorkflowMessage } from '../../web/src/lib/contracts/feedback.js'
void chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' })
const runtimePage = chrome.runtime.getURL('runtime.html')
const read = async (id: string) => (await chrome.storage.local.get(captureKey(id)))[captureKey(id)]
const reader = createCaptureReadMachine({
	id: chrome.runtime.id,
	page: runtimePage,
	read,
	tab: (id) => chrome.tabs.get(id),
	capture: async (capture) =>
		(
			await chrome.scripting.executeScript({
				target: { tabId: capture.tabId, documentIds: [capture.documentId] },
				func: serializePage
			})
		)[0]?.result
})
const references = createReferenceMachine({
	id: chrome.runtime.id,
	page: runtimePage,
	read,
	write: (capture) => chrome.storage.local.set({ [captureKey(capture.id)]: capture }),
	remove: (id) => chrome.storage.local.remove(captureKey(id))
})
function show(
	capture: Capture,
	message: WorkflowMessage,
	revision: number,
	reset: boolean,
	articleId?: string
) {
	const href = articleId ? new URL(`articles/${articleId}`, __CLIPPER_WEB__).href : __CLIPPER_WEB__
	return chrome.scripting.executeScript({
		target: { tabId: capture.tabId, documentIds: [capture.documentId] },
		func: renderBar,
		args: [
			{
				id: capture.id,
				revision,
				reset,
				...message,
				href,
				open: action('open', articleId ? 'article' : 'library'),
				close: t('actions.close')
			}
		]
	})
}
chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
	const changed = accountChangedSchema.safeParse(message)
	if (
		changed.success &&
		trustedSender(sender, chrome.runtime.id, chrome.runtime.getURL('index.html'))
	) {
		void chrome.runtime
			.sendMessage({ ...changed.data, target: 'runtime' })
			.then(reply, () => reply({ accepted: false }))
		return true
	}

	const waiting = waitingSchema.safeParse(message)
	if (waiting.success && trustedSender(sender, chrome.runtime.id, runtimePage)) {
		const update = waiting.data
		void read(update.id)
			.then((value) => {
				if (!captureFor(value, update.id)) throw new Error('invalidResponse')
				return show(captureSchema.parse(value), update.message, update.revision, false)
			})
			.then(
				() => reply({ accepted: true }),
				() => reply({ accepted: false })
			)
		return true
	}

	const progress = progressSchema.safeParse(message)
	if (progress.success && trustedSender(sender, chrome.runtime.id, runtimePage)) {
		const { capture, message, revision, articleId } = progress.data
		void show(capture, message, revision, false, articleId).then(
			() => reply({ accepted: true }),
			() => reply({ accepted: false })
		)
		return true
	}
	if (messageSchema.safeParse(message).success) {
		const actor = createActor(reader, { input: { message, sender } })
		void toPromise(actor)
			.then(reply, () => reply({ error: 'captureFailed' }))
			.finally(() => actor.stop())
		actor.start()
		return true
	}
	if (referenceMessageSchema.safeParse(message).success) {
		const actor = createActor(references, { input: { message, sender } })
		void toPromise(actor)
			.then(reply, () => reply({ accepted: false }))
			.finally(() => actor.stop())
		actor.start()
		return true
	}
})
const accepted = z.object({ accepted: z.boolean() })
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
		show: (capture, message) => show(capture, message, 0, true),
		runtimeExists: async () =>
			(
				await chrome.runtime.getContexts({
					contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
					documentUrls: [runtimePage]
				})
			).length > 0,
		createRuntime: () =>
			chrome.offscreen.createDocument({
				url: 'runtime.html',
				reasons: [chrome.offscreen.Reason.WORKERS, chrome.offscreen.Reason.LOCAL_STORAGE],
				justification:
					'Save the requested article using the existing local account and packaged workers without opening a tab.'
			}),
		dispatch: async (id) =>
			accepted.parse(await chrome.runtime.sendMessage({ target: 'runtime', type: 'RUN', id }))
				.accepted,

		reject: (tab, text) =>
			chrome.action.setTitle({ ...(tab?.id === undefined ? {} : { tabId: tab.id }), title: text }),
		id: () => crypto.randomUUID()
	})
).start()
chrome.action.onClicked.addListener((tab) => launcher.send({ type: 'CLIP', tab }))
