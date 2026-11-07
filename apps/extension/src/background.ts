import { createNotificationMachine } from './notification-machine.js'
import { createConnectStoreMachine } from './connect-store-machine.js'
import { authorizationSchema, connectionFor, connectionKey } from './connection.js'
import { createLaunchMachine } from './launch-machine.js'
import { createActor, toPromise } from 'xstate'
import { z } from 'zod'
import {
	captureKey,
	captureSchema,
	messageSchema,
	referenceMessageSchema,
	notificationSchema,
	connectMessageSchema
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
const connections = createConnectStoreMachine({
	id: chrome.runtime.id,
	pages: [chrome.runtime.getURL('index.html'), chrome.runtime.getURL('signin.html')],
	scope: { appId: __CLIPPER_APP_ID__, serverUrl: __CLIPPER_SERVER__ },
	idForConfirmation: () => crypto.randomUUID(),
	write: (connection) => chrome.storage.local.set({ [connectionKey]: connection }),
	notify: (accountId) =>
		chrome.runtime.sendMessage({ type: 'ACCOUNT_CHANGED', accountId, target: 'runtime' })
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
const notifications = createNotificationMachine({
	id: chrome.runtime.id,
	page: runtimePage,
	read,
	show: (display) =>
		show(display.capture, display.message, display.revision, false, display.articleId)
})
chrome.runtime.onMessage.addListener((message: unknown, sender, reply) => {
	if (connectMessageSchema.safeParse(message).success) {
		const actor = createActor(connections, { input: { message, sender } })
		void toPromise(actor)
			.then(reply, () => reply({ accepted: false }))
			.finally(() => actor.stop())
		actor.start()
		return true
	}

	if (notificationSchema.safeParse(message).success) {
		const actor = createActor(notifications, { input: { message, sender } })
		void toPromise(actor)
			.then(reply, () => reply({ accepted: false }))
			.finally(() => actor.stop())
		actor.start()
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
		connection: async () =>
			connectionFor((await chrome.storage.local.get(connectionKey))[connectionKey], {
				appId: __CLIPPER_APP_ID__,
				serverUrl: __CLIPPER_SERVER__
			}),
		authorize: async (connection) =>
			authorizationSchema.parse(
				await chrome.runtime.sendMessage({
					type: 'AUTHORIZE',
					target: 'runtime',
					accountId: connection.accountId
				})
			).status,
		openSignIn: async (requestId) =>
			z
				.number()
				.int()
				.parse(
					(
						await chrome.windows.create({
							type: 'popup',
							url: chrome.runtime.getURL(`signin.html?request=${requestId}`),
							width: 480,
							height: 580,
							focused: true
						})
					)?.id
				),
		watchPopup: (id, closed) => {
			const removed = (windowId: number) => {
				if (windowId === id) closed()
			}
			chrome.windows.onRemoved.addListener(removed)
			void chrome.windows.get(id).catch(closed)
			return () => chrome.windows.onRemoved.removeListener(removed)
		},
		focusPopup: (id) => chrome.windows.update(id, { focused: true }),
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
		dispatch: async (id, accountId) =>
			accepted.parse(
				await chrome.runtime.sendMessage({ target: 'runtime', type: 'RUN', id, accountId })
			).accepted,

		reject: (tab, text) =>
			chrome.action.setTitle({ ...(tab?.id === undefined ? {} : { tabId: tab.id }), title: text }),
		id: () => crypto.randomUUID()
	})
).start()
chrome.action.onClicked.addListener((tab) => launcher.send({ type: 'CLIP', tab }))
