import { createActor, toPromise, waitFor } from 'xstate'
import { stopAfterShutdown } from 'delightful-local-first/forms/lifecycle'
import {
	createApplicationReadinessMachine,
	selectLibraryActor,
	selectApplicationView
} from '../../web/src/lib/machines/runtime/application-readiness.js'
import { existingAccountInput, type Session } from '../../web/src/lib/backend/jazz/account.js'
import { extensionLibrary } from './library.js'
import { createRuntimeMachine } from './runtime-machine.js'
import {
	acceptedAcknowledgmentSchema,
	authorizationRequestSchema,
	backgroundSender,
	runtimeMessageSchema
} from './protocol.js'
import { createAuthorizationMachine, selectAccountAccess } from './authorization-machine.js'
import { extractSource } from './worker.js'
async function command(message: unknown) {
	if (!acceptedAcknowledgmentSchema.safeParse(await chrome.runtime.sendMessage(message)).success)
		throw new Error('invalidResponse')
}
const owner = createActor(createApplicationReadinessMachine<Session>(), {
	input: existingAccountInput(
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
			const subscription = owner.subscribe((snapshot) => {
				const view = selectApplicationView(snapshot, true)
				bind(selectLibraryActor(snapshot), view.message, view.status)
			})
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
	const authorization = authorizationRequestSchema.safeParse(value)
	if (
		authorization.success &&
		backgroundSender(sender, chrome.runtime.id, chrome.runtime.getURL('background.js'))
	) {
		const actor = createActor(
			createAuthorizationMachine((notify) => {
				const publish = () => notify(selectAccountAccess(runtime.getSnapshot()))
				const subscription = runtime.subscribe(publish)
				publish()
				return () => subscription.unsubscribe()
			}),
			{ input: { expected: authorization.data.accountId } }
		)
		void toPromise(actor)
			.then(reply, () => reply({ status: 'unavailable' }))
			.finally(() => actor.stop())
		actor.start()
		return true
	}

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
