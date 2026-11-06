import { afterEach, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import { atprotoMachine } from './atproto.js'
import type { TokenIdentityCommand } from './application-readiness.js'

const accountId = '77777777-7777-4777-8777-777777777777'
function fixture(record?: unknown) {
	const values = new Map<string, string>()
	if (record) values.set('clipper.atproto.pending.v1', JSON.stringify(record))
	const storage: Storage = {
		get length() {
			return values.size
		},
		clear: () => values.clear(),
		getItem: (key) => values.get(key) ?? null,
		setItem: (key, value) => {
			values.set(key, value)
		},
		removeItem: (key) => {
			values.delete(key)
		},
		key: (index) => [...values.keys()][index] ?? null
	}
	const dispatch = vi.fn<(command: TokenIdentityCommand) => void>()
	const navigate = vi.fn()
	const actor = createActor(atprotoMachine, {
		input: { storage, dispatch, navigate, origin: 'https://example.invalid' }
	}).start()
	return { actor, storage, dispatch, navigate }
}
afterEach(() => vi.unstubAllGlobals())

it('does not request provider state or tokens without a pending action', async () => {
	const fetch = vi.fn()
	vi.stubGlobal('fetch', fetch)
	const f = fixture()
	f.actor.send({ type: 'RESUME', accountId })
	await waitFor(f.actor, (s) => s.matches('idle'))
	expect(fetch).not.toHaveBeenCalled()
	expect(f.dispatch).not.toHaveBeenCalled()
	f.actor.send({ type: 'SHUTDOWN' })
})
it('rejects an OAuth return for a different local library', async () => {
	const fetch = vi.fn()
	vi.stubGlobal('fetch', fetch)
	const f = fixture({ operation: 'connect', accountId })
	f.actor.send({ type: 'RESUME', accountId: crypto.randomUUID() })
	await waitFor(f.actor, (s) => s.matches('failed'))
	expect(fetch).not.toHaveBeenCalled()
	expect(f.storage.length).toBe(0)
	f.actor.send({ type: 'SHUTDOWN' })
})
it('resumes an explicit connection and retains intent until the owner settles', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ user: { id: 'provider-user' } }))
	)
	const f = fixture({ operation: 'connect', accountId })
	f.actor.send({ type: 'RESUME', accountId })
	await waitFor(f.actor, (s) => s.matches('settling'))
	expect(f.dispatch).toHaveBeenCalledTimes(1)
	const command = f.dispatch.mock.calls[0]![0]
	expect(command.type).toBe('CONNECT_TOKEN')
	expect(f.storage.length).toBe(1)
	f.actor.send({ type: 'SHUTDOWN' })
	expect(f.actor.getSnapshot().status).toBe('active')
	command.reportTo?.send({ type: 'TOKEN_SUCCEEDED' })
	await waitFor(f.actor, (s) => s.status === 'done')
	// A shutdown return is not retried; no credential was stored in the intent.
	expect(f.storage.length).toBe(0)
})
it('clears a successful sign-in intent and uses only the sign-in command', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ user: { id: 'provider-user' } }))
	)
	const f = fixture({ operation: 'sign-in', accountId })
	f.actor.send({ type: 'RESUME', accountId })
	await waitFor(f.actor, (s) => s.matches('settling'))
	const command = f.dispatch.mock.calls[0]![0]
	expect(command.type).toBe('SIGN_IN_TOKEN')
	command.reportTo?.send({ type: 'TOKEN_SUCCEEDED' })
	await waitFor(f.actor, (s) => s.matches('succeeded'))
	expect(f.storage.length).toBe(0)
	f.actor.send({ type: 'SHUTDOWN' })
})
it('rejects a refreshed token for a different provider user', async () => {
	const token =
		'header.' +
		btoa(
			JSON.stringify({
				sub: 'other-user',
				iss: 'https://example.invalid',
				aud: 'https://example.invalid'
			})
		) +
		'.signature'
	vi.stubGlobal(
		'fetch',
		vi.fn(async (url: string) =>
			Response.json(url.endsWith('/get-session') ? { user: { id: 'provider-user' } } : { token })
		)
	)
	const f = fixture({ operation: 'connect', accountId })
	f.actor.send({ type: 'RESUME', accountId })
	await waitFor(f.actor, (s) => s.matches('settling'))
	await expect(f.dispatch.mock.calls[0]![0].source.getToken()).rejects.toThrow('identity changed')
	f.actor.send({ type: 'TOKEN_FAILED' })
	f.actor.send({ type: 'SHUTDOWN' })
})

it('keeps local startup usable when tab storage is unavailable', async () => {
	const fetch = vi.fn()
	vi.stubGlobal('fetch', fetch)
	const f = fixture()
	vi.spyOn(f.storage, 'getItem').mockImplementation(() => {
		throw new Error('Storage blocked')
	})
	f.actor.send({ type: 'RESUME', accountId })
	await waitFor(f.actor, (s) => s.matches('idle'))
	expect(fetch).not.toHaveBeenCalled()
	expect(f.dispatch).not.toHaveBeenCalled()
	f.actor.send({ type: 'SHUTDOWN' })
})
