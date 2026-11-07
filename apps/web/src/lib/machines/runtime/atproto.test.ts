import {
	createBrowserTokenSelection,
	type TokenSelectionStore
} from 'delightful-local-first/identity/token/selection'
import { afterEach, expect, it, vi } from 'vitest'
import { createActor, waitFor } from 'xstate'
import { atprotoMachine, atprotoInput } from './atproto.js'
import type { TokenIdentityCommand } from './application-readiness.js'

const attemptId = '88888888-8888-4888-8888-888888888888'
const accountId = '77777777-7777-4777-8777-777777777777'
function fixture(record?: unknown, remembered?: unknown, override?: TokenSelectionStore) {
	const selections = new Map<string, string>()
	if (remembered) selections.set('test-selection', JSON.stringify(remembered))
	const selection = createBrowserTokenSelection(
		{
			getItem: (key) => selections.get(key) ?? null,
			setItem: (key, value) => {
				selections.set(key, value)
			},
			removeItem: (key) => {
				selections.delete(key)
			}
		},
		'test-selection'
	)
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
		input: atprotoInput({
			storage,
			dispatch,
			navigate,
			origin: 'https://example.invalid',
			selection: override ?? selection
		})
	}).start()
	return { actor, storage, dispatch, navigate, selection, selections }
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
	const f = fixture({ operation: 'connect', accountId, attemptId })
	f.actor.send({ type: 'RESUME', accountId: crypto.randomUUID() })
	await waitFor(f.actor, (s) => s.matches('failed'))
	expect(fetch).not.toHaveBeenCalled()
	expect(f.storage.length).toBe(0)
	f.actor.send({ type: 'SHUTDOWN' })
})
it('consumes the intent before issue and waits for the owner to settle', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ attemptId, userId: 'provider-user' }))
	)
	const f = fixture({ operation: 'connect', accountId, attemptId })
	f.actor.send({ type: 'RESUME', accountId })
	await waitFor(f.actor, (s) => s.matches('settling'))
	expect(f.dispatch).toHaveBeenCalledTimes(1)
	const command = f.dispatch.mock.calls[0]![0]
	expect(command.type).toBe('CONNECT_TOKEN')
	expect(f.storage.length).toBe(0)
	f.actor.send({ type: 'SHUTDOWN' })
	expect(f.actor.getSnapshot().status).toBe('active')
	command.reportTo?.send({ type: 'TOKEN_SUCCEEDED', attemptId, accountId })
	await waitFor(f.actor, (s) => s.status === 'done')
	// A shutdown return is not retried; no credential was stored in the intent.
	expect(f.storage.length).toBe(0)
})
it('clears a successful sign-in intent and uses only the sign-in command', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ attemptId, userId: 'provider-user' }))
	)
	const f = fixture({ operation: 'sign-in', accountId, attemptId })
	f.actor.send({ type: 'RESUME', accountId })
	await waitFor(f.actor, (s) => s.matches('settling'))
	const command = f.dispatch.mock.calls[0]![0]
	expect(command.type).toBe('SIGN_IN_TOKEN')
	command.reportTo?.send({ type: 'TOKEN_SUCCEEDED', attemptId, accountId })
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
			Response.json(
				url.endsWith('/atproto/completion') ? { attemptId, userId: 'provider-user' } : { token }
			)
		)
	)
	const f = fixture({ operation: 'connect', accountId, attemptId })
	f.actor.send({ type: 'RESUME', accountId })
	await waitFor(f.actor, (s) => s.matches('settling'))
	await expect(f.dispatch.mock.calls[0]![0].source.getToken()).rejects.toThrow('identity changed')
	f.actor.send({ type: 'TOKEN_FAILED', attemptId })
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

it('does not resume interrupted authorization using an older provider login', async () => {
	const authorize = Promise.withResolvers<Response>()
	const fetch = vi.fn(async (url: string) =>
		url.endsWith('/sign-in/atproto')
			? authorize.promise
			: Response.json({ user: { id: 'older-provider-user' } })
	)
	vi.stubGlobal('fetch', fetch)
	const first = fixture()
	first.actor.send({
		type: 'BEGIN',
		intent: { operation: 'connect', accountId },
		handle: 'new.example.invalid'
	})
	await waitFor(first.actor, (s) => s.matches('authorizing'))
	const raw = first.storage.getItem('clipper.atproto.pending.v1')!
	first.actor.send({ type: 'SHUTDOWN' })
	const resumed = fixture(JSON.parse(raw))
	resumed.actor.send({ type: 'RESUME', accountId })
	await waitFor(resumed.actor, (s) => s.matches('failed'))
	expect(resumed.dispatch).not.toHaveBeenCalled()
	expect(fetch.mock.calls.map(([url]) => url)).not.toContain('/api/auth/get-session')
	expect(resumed.storage.length).toBe(0)
	resumed.actor.send({ type: 'SHUTDOWN' })
})

it('rejects callback completion for a different authorization attempt', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ attemptId: crypto.randomUUID(), userId: 'provider-user' }))
	)
	const f = fixture({ operation: 'connect', accountId, attemptId })
	f.actor.send({ type: 'RESUME', accountId })
	await waitFor(f.actor, (s) => s.matches('failed'))
	expect(f.dispatch).not.toHaveBeenCalled()
	f.actor.send({ type: 'SHUTDOWN' })
})

it('blocks identity issue if consuming the persisted intent fails', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ attemptId, userId: 'provider-user' }))
	)
	const f = fixture({ operation: 'connect', accountId, attemptId })
	vi.spyOn(f.storage, 'removeItem').mockImplementation(() => {
		throw new Error('Storage blocked')
	})
	f.actor.send({ type: 'RESUME', accountId })
	await waitFor(f.actor, (s) => s.matches('cleanupFailed'))
	expect(f.dispatch).not.toHaveBeenCalled()
	expect(f.storage.length).toBe(1)
	f.actor.send({
		type: 'BEGIN',
		intent: { operation: 'connect', accountId },
		handle: 'retry.example.invalid'
	})
	expect(f.actor.getSnapshot().matches('cleanupFailed')).toBe(true)
	f.actor.send({ type: 'SHUTDOWN' })
})

it('rejects stale settlement and does not replay a consumed operation on reload', async () => {
	const fetch = vi.fn(async () => Response.json({ attemptId, userId: 'provider-user' }))
	vi.stubGlobal('fetch', fetch)
	const f = fixture({ operation: 'connect', accountId, attemptId })
	f.actor.send({ type: 'RESUME', accountId })
	await waitFor(f.actor, (s) => s.matches('settling'))
	for (const type of [
		'TOKEN_SUCCEEDED',
		'TOKEN_FAILED',
		'TOKEN_CANCELLED',
		'TOKEN_UNRESOLVED'
	] as const) {
		f.actor.send({ type, attemptId: crypto.randomUUID(), accountId })
		expect(f.actor.getSnapshot().matches('settling')).toBe(true)
	}
	f.actor.send({ type: 'RESUME', accountId })
	expect(f.dispatch).toHaveBeenCalledOnce()
	expect(f.storage.length).toBe(0)
	const restarted = fixture()
	restarted.actor.send({ type: 'RESUME', accountId })
	await waitFor(restarted.actor, (s) => s.matches('idle'))
	expect(restarted.dispatch).not.toHaveBeenCalled()
	expect(fetch).toHaveBeenCalledOnce()
	restarted.actor.send({ type: 'SHUTDOWN' })
	f.actor.send({ type: 'TOKEN_UNRESOLVED', attemptId })
	expect(f.actor.getSnapshot().matches('unresolved')).toBe(true)
	f.actor.send({
		type: 'BEGIN',
		intent: { operation: 'connect', accountId },
		handle: 'retry.example.invalid'
	})
	expect(f.dispatch).toHaveBeenCalledOnce()
	expect(f.actor.getSnapshot().matches('unresolved')).toBe(true)
	f.actor.send({ type: 'SHUTDOWN' })
})

it('ignores completion that arrives after shutdown during provider verification', async () => {
	const response = Promise.withResolvers<Response>()
	vi.stubGlobal(
		'fetch',
		vi.fn(() => response.promise)
	)
	const f = fixture({ operation: 'connect', accountId, attemptId })
	f.actor.send({ type: 'RESUME', accountId })
	await waitFor(f.actor, (s) => s.matches('session'))
	f.actor.send({ type: 'SHUTDOWN' })
	response.resolve(Response.json({ attemptId, userId: 'provider-user' }))
	await Promise.resolve()
	expect(f.actor.getSnapshot().status).toBe('done')
	expect(f.dispatch).not.toHaveBeenCalled()
})

it.each(['TOKEN_CANCELLED', 'TOKEN_UNRESOLVED', 'TOKEN_FAILED', 'TOKEN_SUCCEEDED'] as const)(
	'joins shutdown on the correlated %s result',
	async (type) => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ attemptId, userId: 'provider-user' }))
		)
		const f = fixture({ operation: 'connect', accountId, attemptId })
		f.actor.send({ type: 'RESUME', accountId })
		await waitFor(f.actor, (s) => s.matches('settling'))
		f.actor.send({ type: 'SHUTDOWN' })
		f.actor.send({ type, attemptId: crypto.randomUUID(), accountId })
		expect(f.actor.getSnapshot().status).toBe('active')
		f.actor.send({ type, attemptId, accountId })
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.dispatch).toHaveBeenCalledOnce()
	}
)

it('terminates an issued operation as unresolved if its account owner fails', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ attemptId, userId: 'provider-user' }))
	)
	const f = fixture({ operation: 'connect', accountId, attemptId })
	f.actor.send({ type: 'RESUME', accountId })
	await waitFor(f.actor, (s) => s.matches('settling'))
	f.actor.send({ type: 'OWNER_FAILED' })
	expect(f.actor.getSnapshot().matches('unresolvedClosed')).toBe(true)
	expect(f.actor.getSnapshot().status).toBe('done')
	expect(f.storage.length).toBe(0)
})

const remembered = { issuer: 'https://example.invalid', userId: 'provider-user', accountId }
it('remembers a completed sign-in and restores that account in a new owner', async () => {
	const fetch = vi.fn(async (path: string) =>
		Response.json(
			path.endsWith('/completion')
				? { attemptId, userId: remembered.userId }
				: { user: { id: remembered.userId } }
		)
	)
	vi.stubGlobal('fetch', fetch)
	const originalLocalId = crypto.randomUUID()
	const first = fixture({ operation: 'sign-in', accountId: originalLocalId, attemptId })
	first.actor.send({ type: 'RESUME', accountId: originalLocalId })
	await waitFor(first.actor, (s) => s.matches('settling'))
	expect(await first.selection.read()).toBeUndefined()
	first.dispatch.mock.calls[0]![0].reportTo?.send({ type: 'TOKEN_SUCCEEDED', attemptId, accountId })
	await waitFor(first.actor, (s) => s.matches('succeeded'))
	expect(await first.selection.read()).toEqual(remembered)
	first.actor.send({ type: 'SHUTDOWN' })
	const restored = fixture(undefined, await first.selection.read())
	const localId = crypto.randomUUID()
	restored.actor.send({ type: 'RESUME', accountId: localId })
	await waitFor(restored.actor, (s) => s.matches('restoringSelection'))
	const command = restored.dispatch.mock.calls[0]![0]
	expect(command).toMatchObject({
		type: 'RESTORE_TOKEN',
		accountId: localId,
		expectedAccountId: accountId
	})
	expect(fetch.mock.calls.map(([path]) => path)).toEqual([
		'/api/auth/atproto/completion',
		'/api/auth/get-session'
	])
	command.reportTo?.send({ type: 'TOKEN_SUCCEEDED', attemptId: command.attemptId, accountId })
	await waitFor(restored.actor, (s) => s.matches('succeeded'))
	expect(await restored.selection.read()).toEqual(remembered)
	restored.actor.send({ type: 'SHUTDOWN' })
})

it.each(['absent', 'changed', 'offline', 'wrong-issuer', 'malformed'] as const)(
	'does not restore with %s provider evidence',
	async (kind) => {
		const fetch = vi.fn(async () => {
			if (kind === 'offline') throw new Error('Unavailable')
			return Response.json(kind === 'absent' ? null : { user: { id: 'other-user' } })
		})
		vi.stubGlobal('fetch', fetch)
		const selection =
			kind === 'wrong-issuer'
				? { ...remembered, issuer: 'https://other.invalid' }
				: kind === 'malformed'
					? { ...remembered, token: 'must-never-be-accepted' }
					: remembered
		const f = fixture(undefined, selection)
		f.actor.send({ type: 'RESUME', accountId: crypto.randomUUID() })
		await waitFor(f.actor, (s) => s.matches('failed'))
		expect(f.dispatch).not.toHaveBeenCalled()
		expect(fetch).toHaveBeenCalledTimes(kind === 'wrong-issuer' || kind === 'malformed' ? 0 : 1)
		f.actor.send({ type: 'SHUTDOWN' })
	}
)

it('does not fall back to a remembered account while an OAuth attempt is incomplete', async () => {
	const fetch = vi.fn<(path: string) => Promise<Response>>(async () =>
		Response.json({ user: { id: remembered.userId } })
	)
	vi.stubGlobal('fetch', fetch)
	const f = fixture({ operation: 'connect', accountId, attemptId }, remembered)
	f.actor.send({ type: 'RESUME', accountId })
	await waitFor(f.actor, (s) => s.matches('failed'))
	expect(f.dispatch).not.toHaveBeenCalled()
	expect(fetch.mock.calls.map(([path]) => path)).toEqual(['/api/auth/atproto/completion'])
	f.actor.send({ type: 'SHUTDOWN' })
})

it('blocks new identity issue when invalidating an old selection fails', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ attemptId, userId: remembered.userId }))
	)
	const clear = vi.fn(async () => {
		throw new Error('Storage unavailable')
	})
	const f = fixture({ operation: 'connect', accountId, attemptId }, remembered, {
		read: async () => remembered,
		clear,
		save: vi.fn()
	})
	f.actor.send({ type: 'RESUME', accountId })
	await waitFor(f.actor, (s) => s.matches('cleanupFailed'))
	expect(clear).toHaveBeenCalledOnce()
	expect(f.dispatch).not.toHaveBeenCalled()
	expect(f.storage.length).toBe(1)
	f.actor.send({ type: 'SHUTDOWN' })
})

it('reports selection persistence failure without replaying a successful identity mutation', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ attemptId, userId: remembered.userId }))
	)
	const save = vi.fn(async () => {
		throw new Error('Storage unavailable')
	})
	const f = fixture({ operation: 'connect', accountId, attemptId }, undefined, {
		read: async () => undefined,
		clear: async () => {},
		save
	})
	f.actor.send({ type: 'RESUME', accountId })
	await waitFor(f.actor, (s) => s.matches('settling'))
	f.actor.send({ type: 'TOKEN_SUCCEEDED', attemptId, accountId })
	await waitFor(f.actor, (s) => s.matches('cleanupFailed'))
	expect(save).toHaveBeenCalledExactlyOnceWith(remembered)
	expect(f.dispatch).toHaveBeenCalledOnce()
	expect(f.storage.length).toBe(0)
	f.actor.send({ type: 'RESUME', accountId })
	expect(f.dispatch).toHaveBeenCalledOnce()
	f.actor.send({ type: 'SHUTDOWN' })
})

it.each(['SHUTDOWN', 'OWNER_FAILED'] as const)(
	'owns selection persistence through %s',
	async (type) => {
		vi.stubGlobal(
			'fetch',
			vi.fn(async () => Response.json({ attemptId, userId: remembered.userId }))
		)
		const saving = Promise.withResolvers<void>()
		const f = fixture({ operation: 'connect', accountId, attemptId }, undefined, {
			read: async () => undefined,
			clear: async () => {},
			save: () => saving.promise
		})
		f.actor.send({ type: 'RESUME', accountId })
		await waitFor(f.actor, (s) => s.matches('settling'))
		f.actor.send({ type: 'TOKEN_SUCCEEDED', attemptId, accountId })
		await waitFor(f.actor, (s) => s.matches('remembering'))
		f.actor.send({ type })
		expect(f.actor.getSnapshot().status).toBe('active')
		saving.resolve()
		await waitFor(f.actor, (s) => s.status === 'done')
		expect(f.dispatch).toHaveBeenCalledOnce()
	}
)

it('rejects stale restoration results and owns the actual result through shutdown', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ user: { id: remembered.userId } }))
	)
	const f = fixture(undefined, remembered)
	f.actor.send({ type: 'RESUME', accountId: crypto.randomUUID() })
	await waitFor(f.actor, (s) => s.matches('restoringSelection'))
	const command = f.dispatch.mock.calls[0]![0]
	f.actor.send({ type: 'TOKEN_SUCCEEDED', attemptId: crypto.randomUUID(), accountId })
	expect(f.actor.getSnapshot().matches('restoringSelection')).toBe(true)
	f.actor.send({ type: 'SHUTDOWN' })
	expect(f.actor.getSnapshot().status).toBe('active')
	f.actor.send({ type: 'TOKEN_SUCCEEDED', attemptId: command.attemptId, accountId })
	await waitFor(f.actor, (s) => s.status === 'done')
	expect(f.dispatch).toHaveBeenCalledOnce()
})

it('rejects an unexpected account and does not replace the remembered target', async () => {
	vi.stubGlobal(
		'fetch',
		vi.fn(async () => Response.json({ user: { id: remembered.userId } }))
	)
	const f = fixture(undefined, remembered)
	f.actor.send({ type: 'RESUME', accountId: crypto.randomUUID() })
	await waitFor(f.actor, (s) => s.matches('restoringSelection'))
	const command = f.dispatch.mock.calls[0]![0]
	f.actor.send({
		type: 'TOKEN_SUCCEEDED',
		attemptId: command.attemptId,
		accountId: crypto.randomUUID()
	})
	expect(f.actor.getSnapshot().matches('unresolved')).toBe(true)
	expect(await f.selection.read()).toEqual(remembered)
	f.actor.send({ type: 'SHUTDOWN' })
})

it('does not restore after explicit selection removal even if the provider remains signed in', async () => {
	const fetch = vi.fn<(path: string) => Promise<Response>>(async () =>
		Response.json({ user: { id: remembered.userId } })
	)
	vi.stubGlobal('fetch', fetch)
	const f = fixture(undefined, remembered)
	await f.selection.clear()
	const next = fixture(undefined, await f.selection.read())
	next.actor.send({ type: 'RESUME', accountId: crypto.randomUUID() })
	await waitFor(next.actor, (s) => s.matches('idle'))
	expect(fetch).not.toHaveBeenCalled()
	expect(next.dispatch).not.toHaveBeenCalled()
	f.actor.send({ type: 'SHUTDOWN' })
	next.actor.send({ type: 'SHUTDOWN' })
})

it('scopes remembered selection by Jazz app, server and environment', async () => {
	const { atprotoSelectionStore } = await import('./atproto.js')
	const values = new Map<string, string>()
	const storage = {
		getItem: (key: string) => values.get(key) ?? null,
		setItem: (key: string, value: string) => {
			values.set(key, value)
		},
		removeItem: (key: string) => {
			values.delete(key)
		}
	}
	const config = {
		appId: crypto.randomUUID(),
		serverUrl: 'https://sync.example.invalid/',
		env: 'clipper'
	}
	const selected = atprotoSelectionStore(config, storage)
	await selected.save(remembered)
	expect(await atprotoSelectionStore({ ...config }, storage).read()).toEqual(remembered)
	for (const other of [
		{ ...config, appId: crypto.randomUUID() },
		{ ...config, serverUrl: 'https://other.invalid/' },
		{ ...config, env: 'other' }
	]) {
		expect(await atprotoSelectionStore(other, storage).read()).toBeUndefined()
	}
	expect([...values.values()].map((value) => Object.keys(JSON.parse(value)))).toEqual([
		['issuer', 'userId', 'accountId']
	])
})
