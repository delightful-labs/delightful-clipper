import { createActor, waitFor } from 'xstate'
import { z } from 'zod'
import { stopAfterShutdown } from 'delightful-local-first/forms/lifecycle'
import {
	createApplicationReadinessMachine,
	selectLibraryActor,
	selectApplicationView
} from '../../web/src/lib/machines/runtime/application-readiness.js'
import { accountInput, type Session } from '../../web/src/lib/backend/jazz/account.js'
import { extensionLibrary } from './library.js'
import { createRuntimeMachine } from './runtime-machine.js'
import { backgroundSender, runtimeMessageSchema } from './protocol.js'
import { extractSource } from './worker.js'
const acceptedSchema = z.object({ accepted: z.literal(true) })
async function command(message: unknown) {
	if (!acceptedSchema.safeParse(await chrome.runtime.sendMessage(message)).success)
		throw new Error('invalidResponse')
}
const owner = createActor(createApplicationReadinessMachine<Session>(), {
	input: accountInput(
		{ appId: __CLIPPER_APP_ID__, serverUrl: __CLIPPER_SERVER__, env: 'clipper' },
		extensionLibrary
	)
})

const runtime = createActor(
	createRuntimeMachine({
		reload: async () => {
			owner.send({ type: 'SHUTDOWN' })
			await waitFor(owner, (snapshot) => snapshot.status === 'done')
			location.reload()
		},
		account: (bind) => {
			const subscription = owner.subscribe((snapshot) =>
				bind(selectLibraryActor(snapshot), selectApplicationView(snapshot, true).message)
			)
			owner.start()
			return () => {
				subscription.unsubscribe()
				stopAfterShutdown(owner)
			}
		},
		clip: (library) => {
			const bound = library.getSnapshot().context.capability!
			return {
				library,
				accountId: bound.libraryId,
				current: bound.isCurrent,
				read: (id) => chrome.runtime.sendMessage({ type: 'CAPTURE', id }),
				extract: extractSource,
				issue: (capture, accountId) => command({ type: 'ISSUE', id: capture.id, accountId }),
				remove: (id) => command({ type: 'REMOVE', id })
			}
		},
		waiting: (ids, message, revision) =>
			Promise.all(
				ids.map((id) => chrome.runtime.sendMessage({ type: 'WAITING', id, message, revision }))
			),
		report: async (snapshot, revision) => {
			const { capture, message, articleId } = snapshot.context
			if (!capture || !message) return
			await chrome.runtime.sendMessage({
				type: 'PROGRESS',
				capture,
				revision,
				message,
				...(articleId ? { articleId } : {})
			})
		}
	})
).start()
chrome.runtime.onMessage.addListener((value: unknown, sender, reply) => {
	const parsed = runtimeMessageSchema.safeParse(value)
	if (
		!parsed.success ||
		!backgroundSender(sender, chrome.runtime.id, chrome.runtime.getURL('background.js'))
	)
		return
	const { target: _target, ...event } = parsed.data
	const accepted = runtime.getSnapshot().can(event)
	runtime.send(event)
	reply({ accepted })
})
