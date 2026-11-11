import type { AccountWorkerReply } from './account-client.js'
import { z } from 'zod'
import { createActor } from 'xstate'
import { machineDiagnostics } from '../../web/src/lib/diagnostics/inspect.js'
import type { accountInput } from '../../web/src/lib/backend/jazz/account.js'
import { serveApplicationWorker } from '../../web/src/lib/runtime/worker/serve-application.js'
import { extensionAccountStorageKey } from './account-storage.js'
import { extensionLibrary } from './library.js'
import { createSignInMachine, connectionObservation, signInView } from './signin-machine.js'
import { connectMessageSchema } from './protocol.js'

const initialize = z.object({
	type: z.literal('EXTENSION_INITIALIZE'),
	port: z.instanceof(MessagePort),
	request: z.string().nullable()
})
const command = z.discriminatedUnion('type', [
	z.object({ type: z.literal('RESTORE'), phrase: z.string().max(4096) }),
	z.object({ type: z.literal('RETRY') }),
	z.object({ type: z.literal('CONFIRMED'), id: z.uuid(), accepted: z.boolean() })
])
/** Worker realm boundary: account and confirmation actors stay out of disposable
 * extension pages. Chrome messaging is a narrowly scoped Window-only leaf. */
export function serveExtensionAccount(options: {
	account: typeof accountInput
	connected: (shutdown: () => void) => void
	closed: (port: MessagePort) => void
}) {
	self.onmessage = ({ data }: MessageEvent<unknown>) => {
		const decoded = initialize.safeParse(data)
		if (!decoded.success) return
		const { port } = decoded.data
		const reply = (message: AccountWorkerReply) => port.postMessage(message)
		const request = connectMessageSchema.shape.requestId.safeParse(
			decoded.data.request ?? undefined
		)
		const requestId = request.success ? request.data : undefined
		const pending = new Map<string, { resolve: () => void; reject: (error: Error) => void }>()
		serveApplicationWorker({
			account: (config) => options.account(config, extensionLibrary),
			storageKey: extensionAccountStorageKey,
			attach: (host) => {
				const owner = () => host.getSnapshot().children.application
				const connection = createActor(
					createSignInMachine({
						connect: (accountId) =>
							new Promise<void>((resolve, reject) => {
								const id = crypto.randomUUID()
								pending.set(id, { resolve, reject })
								reply({
									type: 'CONFIRM',
									id,
									accountId,
									...(requestId ? { requestId } : {})
								})
							}),
						connected: () => options.connected(() => host.send({ type: 'SHUTDOWN' })),
						restore: {
							can: () => owner()?.getSnapshot().can({ type: 'RESTORE', phrase: '' }) ?? false,
							send: (phrase) =>
								host.send({
									type: 'ACCOUNT',
									scope: host.getSnapshot().context.scope,
									event: { type: 'RESTORE', phrase }
								})
						}
					}),
					{ ...machineDiagnostics }
				)
				const publish = () => {
					const snapshot = connection.getSnapshot()
					reply({
						type: 'CONNECTION_VIEW',
						...signInView(owner()?.getSnapshot(), snapshot),
						canRestore: snapshot.can({ type: 'RESTORE', phrase: '' }),
						canRetry: snapshot.can({ type: 'RETRY' })
					})
				}
				const observation = connection.subscribe({
					next: publish,
					error: () => self.postMessage({ type: 'FAILED' })
				})
				port.onmessage = ({ data }: MessageEvent<unknown>) => {
					const parsed = command.safeParse(data)
					if (!parsed.success) return
					const message = parsed.data
					if (message.type !== 'CONFIRMED') {
						connection.send(message)
						return
					}
					const call = pending.get(message.id)
					if (!call) return
					pending.delete(message.id)
					if (message.accepted) call.resolve()
					else call.reject(new Error('connectionUnavailable'))
				}
				port.start()
				connection.start()
				return {
					publish: () => {
						const snapshot = owner()?.getSnapshot()
						if (!host.getSnapshot().matches({ running: 'accepting' }))
							connection.send({ type: 'SHUTDOWN' })
						else if (snapshot)
							connection.send({ type: 'OBSERVED', observation: connectionObservation(snapshot) })
						publish()
					},
					close: () => {
						observation.unsubscribe()
						connection.send({ type: 'SHUTDOWN' })
						for (const call of pending.values()) call.reject(new Error('connectionUnavailable'))
						pending.clear()
						options.closed(port)
						port.close()
					}
				}
			}
		})
	}
}
