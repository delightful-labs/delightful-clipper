import { expect, it, vi } from 'vitest'
import { createActor, toPromise } from 'xstate'
import { createConnectStoreMachine } from './connect-store-machine.js'
import { connectionFor, newlyConfirmedConnection } from './connection.js'
const id = '77777777-7777-4777-8777-777777777777'
const scope = { appId: id, serverUrl: 'https://sync.test/' }
const connection = { version: 1 as const, accountId: id, confirmationId: id, ...scope }
it('rejects absent, malformed and differently scoped confirmations', () => {
	expect(connectionFor(undefined, scope)).toBeUndefined()
	expect(connectionFor({ accountId: id }, scope)).toBeUndefined()
	expect(connectionFor(connection, { ...scope, serverUrl: 'https://other.test/' })).toBeUndefined()
	expect(connectionFor(connection, scope)).toEqual(connection)
	expect(newlyConfirmedConnection({ ...connection, requestId: id }, connection, id)).toBe(false)
	expect(newlyConfirmedConnection({ ...connection, requestId: id }, undefined, id)).toBe(true)
	expect(newlyConfirmedConnection(connection, undefined, id)).toBe(false)
})
it('refuses website senders before writing connection metadata', async () => {
	const write = vi.fn(async () => {})
	const actor = createActor(
		createConnectStoreMachine({
			id: 'clipper',
			pages: ['chrome-extension://clipper/signin.html'],
			scope,
			idForConfirmation: () => id,
			write,
			notify: async () => {}
		}),
		{
			input: {
				message: { type: 'CONNECT', accountId: id },
				sender: { id: 'clipper', url: 'https://example.com/' }
			}
		}
	)
	const result = toPromise(actor)
	actor.start()
	expect(await result).toEqual({ accepted: false })
	expect(write).not.toHaveBeenCalled()
})
it('keeps a confirmed account durable even if no offscreen runtime exists yet', async () => {
	const write = vi.fn(async () => {})
	const identity = vi.fn(() => id)
	const actor = createActor(
		createConnectStoreMachine({
			id: 'clipper',
			pages: ['chrome-extension://clipper/signin.html'],
			scope,
			idForConfirmation: identity,
			write,
			notify: async () => {
				throw new Error('runtime not started')
			}
		}),
		{
			input: {
				message: { type: 'CONNECT', accountId: id },
				sender: { id: 'clipper', url: 'chrome-extension://clipper/signin.html' }
			}
		}
	)
	const result = toPromise(actor)
	expect(identity).not.toHaveBeenCalled()
	actor.start()
	expect(await result).toEqual({ accepted: true })
	expect(write).toHaveBeenCalledWith(connection)
	expect(identity).toHaveBeenCalledOnce()
})

it('does not notify the runtime or grant confirmation when local persistence fails', async () => {
	const notify = vi.fn(async () => {})
	const actor = createActor(
		createConnectStoreMachine({
			id: 'clipper',
			pages: ['chrome-extension://clipper/signin.html'],
			scope,
			idForConfirmation: () => id,
			write: async () => {
				throw new Error('storage unavailable')
			},
			notify
		}),
		{
			input: {
				message: { type: 'CONNECT', accountId: id },
				sender: { id: 'clipper', url: 'chrome-extension://clipper/signin.html' }
			}
		}
	)
	const result = toPromise(actor)
	actor.start()
	expect(await result).toEqual({ accepted: false })
	expect(notify).not.toHaveBeenCalled()
})
