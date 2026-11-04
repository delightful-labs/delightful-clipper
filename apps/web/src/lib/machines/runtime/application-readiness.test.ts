import { controlledSave, testLibraryCapability } from '../capture/library.test-support.js'
import {
	createSessionAcquisitionMachine,
	selectAcquiredSession
} from 'delightful-local-first/session/workflow'
import { createActor, waitFor } from 'xstate'
import { describe, expect, it, vi } from 'vitest'
import {
	createApplicationReadinessMachine,
	selectApplicationView
} from './application-readiness.js'
import type {
	AccountHost,
	AccountInput,
	AccountObservation,
	RootAccess
} from '../../contracts/account.js'

const applicationReadinessMachine = createApplicationReadinessMachine<AccountHost>()
function startup(open: () => Promise<AccountHost>) {
	const binding = {}
	const owner = createActor(createSessionAcquisitionMachine<AccountHost>(), {
		input: { binding, capability: { open } }
	}).start()
	const attach = (): AccountInput<AccountHost> => ({
		startup: { owner, scope: { binding, attachment: {}, generation: 0 } },
		bind: (host) => host
	})
	return { owner, attach }
}
function input(host: AccountHost) {
	return startup(async () => host).attach()
}

function fixture(initial: AccountObservation) {
	let observation = initial
	const listeners = new Set<() => void>()
	const binding = {}
	const host: AccountHost = {
		read: () => observation,
		readiness: {
			binding: {},
			capability: {
				readStatus: () => observation.status,
				subscribe: (notify) => {
					listeners.add(notify)
					return () => {
						listeners.delete(notify)
					}
				},
				retry: vi.fn(async () => {})
			}
		},
		create: vi.fn(async () => {}),
		logout: vi.fn(async () => {}),
		release: vi.fn(() => {}),
		restoration: {
			binding,
			capability: {
				parsePhrase: async () => {
					throw new Error('Invalid synthetic phrase')
				},
				isCurrentBinding: (candidate) => candidate === binding,
				restoreIdentity: vi.fn(async () => {}),
				readIdentity: async () => ({ kind: 'unavailable' })
			}
		}
	}
	return {
		host,
		emit(value: AccountObservation) {
			observation = value
			for (const notify of listeners) notify()
		}
	}
}
function ready(accountId: string, root: RootAccess): AccountObservation {
	return {
		status: 'ready',
		binding: {},
		accountId,
		root,
		recovery: {
			source: {
				subscribe: (notify) => {
					notify({ kind: 'unavailable' })
					return () => {}
				}
			},
			capability: { isCurrentScope: () => false, readPhrase: async () => '' }
		}
	}
}
function root(local: Promise<void>, global: Promise<void>) {
	const localWait = vi.fn(() => local)
	return {
		read: async () => 'compatible',
		ensure: () => ({ local: localWait, global: () => global }),
		localWait
	} satisfies RootAccess & { localWait: typeof localWait }
}

describe('account/root ownership', () => {
	it('reuses DLF-owned late acquisition after releasing the first attachment', async () => {
		const opening = Promise.withResolvers<AccountHost>()
		const { host } = fixture({ status: 'signed-out' })
		const open = vi.fn(() => opening.promise)
		const { owner, attach } = startup(open)
		const actor = createActor(applicationReadinessMachine, { input: attach() }).start()
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		opening.resolve(host)
		await waitFor(owner, (snapshot) => selectAcquiredSession(snapshot) === host)
		expect(host.release).not.toHaveBeenCalled()
		const next = createActor(applicationReadinessMachine, { input: attach() }).start()
		await waitFor(next, (snapshot) =>
			snapshot.matches({ active: { flow: { running: 'signedOut' } } })
		)
		expect(open).toHaveBeenCalledOnce()
		next.send({ type: 'SHUTDOWN' })
		await waitFor(next, (snapshot) => snapshot.status === 'done')
		expect(host.release).toHaveBeenCalledOnce()
		expect(next.getSnapshot().context.host).toBeUndefined()
		owner.stop()
	})
	it('does not call a locally pending root saved or synced', async () => {
		const local = Promise.withResolvers<void>(),
			global = Promise.withResolvers<void>()
		const access = root(local.promise, global.promise)
		const { host } = fixture(ready('owner', access))
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
		await vi.waitFor(() => expect(access.localWait).toHaveBeenCalledOnce())
		expect(
			actor.getSnapshot().matches({ active: { flow: { running: { library: 'ready' } } } })
		).toBe(false)
		expect(selectApplicationView(actor.getSnapshot(), true).status).toBe('openingLibrary')
		expect(selectApplicationView(actor.getSnapshot(), true).message.text).toBe(
			'Preparing your private library…'
		)
		local.resolve()
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: { library: { ready: 'syncPending' } } } } })
		)
		expect(selectApplicationView(actor.getSnapshot(), true).status).toBe('localSaved')
		expect(selectApplicationView(actor.getSnapshot(), true).message.text).toBe(
			'Library saved on this device. Sync pending.'
		)
		global.reject(new Error('Authority rejected'))
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: { library: { ready: 'syncFailed' } } } } })
		)
		expect(selectApplicationView(actor.getSnapshot(), true).status).toBe('syncFailed')
		expect(selectApplicationView(actor.getSnapshot(), true).message.text).toBe(
			'Library saved on this device, but sync failed. Retry when connected.'
		)
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
	})
	it('drains a pending root write before releasing the DLF attachment', async () => {
		const local = Promise.withResolvers<void>()
		const access = root(local.promise, Promise.resolve())
		const { host } = fixture(ready('owner', access))
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
		await vi.waitFor(() => expect(access.localWait).toHaveBeenCalledOnce())
		actor.send({ type: 'SHUTDOWN' })
		expect(host.release).not.toHaveBeenCalled()
		local.resolve()
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(host.release).toHaveBeenCalledOnce()
	})
	it('does not publish an old binding after account replacement', async () => {
		const first = Promise.withResolvers<void>()
		const access = root(first.promise, Promise.resolve())
		const initial = ready('first', access)
		const next = ready('second', root(Promise.resolve(), Promise.resolve()))
		const { host, emit } = fixture(initial)
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
		await vi.waitFor(() => expect(access.localWait).toHaveBeenCalledOnce())
		emit(next)
		expect(actor.getSnapshot().context.observation).toBe(next)
		expect(
			actor.getSnapshot().matches({ active: { flow: { running: { library: 'ready' } } } })
		).toBe(false)
		first.resolve()
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: { library: { ready: 'synced' } } } } })
		)
		first.resolve()
		await Promise.resolve()
		expect(actor.getSnapshot().context.observation).toBe(next)
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
	})
	it('does not overwrite an incompatible root', async () => {
		const ensure = vi.fn(() => ({ local: async () => {}, global: async () => {} }))
		const { host } = fixture(ready('owner', { read: async () => 'incompatible', ensure }))
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: { library: 'conflict' } } } })
		)
		expect(ensure).not.toHaveBeenCalled()
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
	})
	it('uses DLF validation and clears an invalid restoration phrase without mutation', async () => {
		const { host } = fixture({ status: 'signed-out' })
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: 'signedOut' } } })
		)
		actor.send({ type: 'RESTORE', phrase: 'invalid synthetic phrase' })
		await waitFor(actor, (snapshot) => snapshot.context.feedback === 'restoreInvalid')
		expect(actor.getSnapshot().context.phrase).toBe('')
		expect(selectApplicationView(actor.getSnapshot(), true).feedbackMessage).toEqual({
			text: 'That recovery phrase is invalid. Check it and try again.',
			variant: 'error'
		})
		expect(host.restoration.capability.restoreIdentity).not.toHaveBeenCalled()
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
	})
	it('retries failed acquisition through the same DLF owner', async () => {
		const { host } = fixture({ status: 'signed-out' })
		const open = vi
			.fn(async () => host)
			.mockRejectedValueOnce(new Error('Synthetic acquisition failure'))
		const { owner, attach } = startup(open)
		const actor = createActor(applicationReadinessMachine, { input: attach() }).start()
		await waitFor(actor, (snapshot) => snapshot.matches({ active: { flow: 'openFailed' } }))
		actor.send({ type: 'RETRY' })
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: 'signedOut' } } })
		)
		expect(open).toHaveBeenCalledTimes(2)
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		owner.stop()
	})
	it('lets DLF drain an issued SDK retry before releasing the attachment', async () => {
		const pending = Promise.withResolvers<void>()
		const { host } = fixture({ status: 'error' })
		const retry = vi.fn(() => pending.promise)
		const bound = {
			...host,
			readiness: { ...host.readiness, capability: { ...host.readiness.capability, retry } }
		}
		const actor = createActor(applicationReadinessMachine, { input: input(bound) }).start()
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: 'unavailable' } } })
		)
		actor.send({ type: 'RETRY' })
		actor.send({ type: 'RETRY' })
		actor.send({ type: 'SHUTDOWN' })
		expect(retry).toHaveBeenCalledOnce()
		expect(host.release).not.toHaveBeenCalled()
		expect(host.restoration.capability.restoreIdentity).not.toHaveBeenCalled()
		pending.resolve()
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(host.release).toHaveBeenCalledOnce()
	})
	it('reobserves subscription failure through DLF without retrying the SDK', async () => {
		const { host } = fixture({ status: 'signed-out' })
		const subscribe = vi.fn(host.readiness.capability.subscribe).mockImplementationOnce(() => {
			throw new Error('Synthetic observer failure')
		})
		const bound = {
			...host,
			readiness: { ...host.readiness, capability: { ...host.readiness.capability, subscribe } }
		}
		const actor = createActor(applicationReadinessMachine, { input: input(bound) }).start()
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: 'unavailable' } } })
		)
		actor.send({ type: 'RETRY' })
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: 'signedOut' } } })
		)
		expect(subscribe).toHaveBeenCalledTimes(2)
		expect(host.readiness.capability.retry).not.toHaveBeenCalled()
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
	})
	it.each(['create', 'logout', 'restore'])(
		'drains %s after acquisition-owner failure and requires reload',
		async (operation) => {
			const pending = Promise.withResolvers<void>()
			const access = root(Promise.resolve(), Promise.resolve())
			const { host } = fixture(
				operation === 'logout' ? ready('owner', access) : { status: 'signed-out' }
			)
			const mutate = vi.fn(() => pending.promise)
			const bound = {
				...host,
				create: mutate,
				logout: mutate,
				restoration: {
					...host.restoration,
					capability: {
						...host.restoration.capability,
						parsePhrase: async () => 'synthetic credential',
						restoreIdentity: mutate
					}
				}
			}
			const { owner, attach } = startup(async () => bound)
			const actor = createActor(applicationReadinessMachine, { input: attach() }).start()
			await waitFor(actor, (snapshot) =>
				operation === 'logout'
					? snapshot.matches({ active: { flow: { running: { library: { ready: 'synced' } } } } })
					: snapshot.matches({ active: { flow: { running: 'signedOut' } } })
			)
			actor.send(
				operation === 'create'
					? { type: 'CREATE' }
					: operation === 'logout'
						? { type: 'LOGOUT' }
						: { type: 'RESTORE', phrase: 'synthetic phrase' }
			)
			await vi.waitFor(() => expect(mutate).toHaveBeenCalledOnce())
			owner.stop()
			expect(host.release).not.toHaveBeenCalled()
			expect(actor.getSnapshot().status).toBe('active')
			expect(actor.getSnapshot().can({ type: 'RETRY' })).toBe(false)
			pending.resolve()
			await waitFor(actor, (snapshot) => snapshot.status === 'done')
			expect(selectApplicationView(actor.getSnapshot(), true)).toMatchObject({
				status: 'ownerFailed',
				canRetry: false,
				requiresReload: true
			})
			expect(host.release).toHaveBeenCalledOnce()
			expect(actor.getSnapshot().context.host).toBeUndefined()
		}
	)
	it('does not offer acquisition retry after its owner has stopped', async () => {
		const { host } = fixture({ status: 'signed-out' })
		const { owner, attach } = startup(async () => host)
		owner.stop()
		const actor = createActor(applicationReadinessMachine, { input: attach() }).start()
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(selectApplicationView(actor.getSnapshot(), true)).toMatchObject({
			status: 'ownerFailed',
			canRetry: false,
			requiresReload: true
		})
	})
	it('reports observer cleanup uncertainty instead of successful closure', async () => {
		const { host } = fixture({ status: 'signed-out' })
		const bound = {
			...host,
			readiness: {
				...host.readiness,
				capability: {
					...host.readiness.capability,
					subscribe: () => () => {
						throw new Error('Synthetic cleanup failure')
					}
				}
			}
		}
		const actor = createActor(applicationReadinessMachine, { input: input(bound) }).start()
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: 'signedOut' } } })
		)
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(selectApplicationView(actor.getSnapshot(), true)).toMatchObject({
			status: 'cleanupFailed',
			requiresReload: true
		})
		expect(host.release).toHaveBeenCalledOnce()
		expect(actor.getSnapshot().context.host).toBeUndefined()
	})
	it('retains a pending root receipt when its acquisition owner fails', async () => {
		const pending = Promise.withResolvers<void>()
		const access = root(pending.promise, Promise.resolve())
		const { host } = fixture(ready('owner', access))
		const { owner, attach } = startup(async () => host)
		const actor = createActor(applicationReadinessMachine, { input: attach() }).start()
		await vi.waitFor(() => expect(access.localWait).toHaveBeenCalledOnce())
		owner.stop()
		expect(host.release).not.toHaveBeenCalled()
		expect(host.restoration.capability.restoreIdentity).not.toHaveBeenCalled()
		pending.resolve()
		await waitFor(actor, (snapshot) => snapshot.status === 'done')
		expect(selectApplicationView(actor.getSnapshot(), true).status).toBe('ownerFailed')
	})
})

it.each([
	'logout',
	'shutdown',
	'replacement',
	'restore',
	'logout-then-shutdown',
	'restore-then-shutdown'
] as const)('drains library writes before %s releases its account binding', async (mode) => {
	const pending = Promise.withResolvers<import('../../contracts/storage.js').SaveResult>()
	const base = ready('owner', root(Promise.resolve(), Promise.resolve()))
	if (base.status !== 'ready') throw new Error('Expected ready')
	const id = crypto.randomUUID()
	const shutdown = vi.fn()
	const save = controlledSave(() => pending.promise, shutdown)
	const library = testLibraryCapability(
		{
			id,
			title: 'Private',
			text: 'private text',
			html: '<p>private text</p>',
			finalUrl: 'https://example.com/',
			submittedUrl: 'https://example.com/',
			provenance: '{}',
			imagesMissing: false
		},
		{ spawnSave: (spawn, input) => spawn(save, { input }) }
	)
	const observation = { ...base, library }
	const { host, emit } = fixture(observation)
	const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
	await waitFor(actor, (s) => s.matches({ active: { flow: { running: { library: 'ready' } } } }))
	const { selectLibraryActor } = await import('./application-readiness.js')
	const product = selectLibraryActor(actor.getSnapshot())
	if (!product) throw new Error('Missing library owner')
	product.send({ type: 'ADD', url: 'https://example.com/' })
	await waitFor(product, (s) => s.matches({ running: { capture: 'saving' } }))
	if (mode === 'logout-then-shutdown' || mode === 'restore-then-shutdown') {
		actor.send(
			mode === 'logout-then-shutdown'
				? { type: 'LOGOUT' }
				: { type: 'RESTORE', phrase: 'invalid synthetic phrase' }
		)
		actor.send({ type: 'SHUTDOWN' })
	} else if (mode === 'replacement')
		emit(ready('other', root(Promise.resolve(), Promise.resolve())))
	else if (mode === 'restore') actor.send({ type: 'RESTORE', phrase: 'invalid synthetic phrase' })
	else actor.send({ type: mode === 'logout' ? 'LOGOUT' : 'SHUTDOWN' })
	await waitFor(actor, (s) =>
		s.matches({ active: { flow: { running: { library: { ready: 'stopping' } } } } })
	)
	expect(shutdown).toHaveBeenCalledOnce()
	expect(selectLibraryActor(actor.getSnapshot())).toBeUndefined()
	expect(host.logout).not.toHaveBeenCalled()
	expect(host.release).not.toHaveBeenCalled()
	expect(host.restoration.capability.restoreIdentity).not.toHaveBeenCalled()
	pending.resolve({ kind: 'unknown', operationId: id })
	if (mode === 'shutdown' || mode.endsWith('-then-shutdown'))
		await waitFor(actor, (s) => s.status === 'done')
	else if (mode === 'restore') await waitFor(actor, (s) => s.context.feedback === 'restoreInvalid')
	else if (mode === 'logout')
		await waitFor(actor, () => vi.mocked(host.logout).mock.calls.length === 1)
	else
		await waitFor(
			actor,
			(s) =>
				s.context.observation.status === 'ready' &&
				s.context.observation.accountId === 'other' &&
				!s.matches({ active: { flow: { running: { library: { ready: 'stopping' } } } } })
		)
	if (mode.endsWith('-then-shutdown')) {
		expect(host.logout).not.toHaveBeenCalled()
		expect(host.restoration.capability.restoreIdentity).not.toHaveBeenCalled()
	}
	expect(product.getSnapshot().status).toBe('done')
	expect(product.getSnapshot().context.url).toBe('')
	actor.send({ type: 'SHUTDOWN' })
})

it.each([false, true])(
	'shows sign-out only for an explicitly signed-in identity (%s)',
	async (signedIn) => {
		const base = ready('owner', root(Promise.resolve(), Promise.resolve()))
		if (base.status !== 'ready') throw new Error('Expected ready')
		const { host } = fixture({ ...base, signedIn })
		const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
		await waitFor(actor, (s) => s.matches({ active: { flow: { running: { library: 'ready' } } } }))
		expect(selectApplicationView(actor.getSnapshot(), true)).toMatchObject({
			canLogout: signedIn,
			canRestore: true
		})
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (s) => s.status === 'done')
	}
)

it('preserves observer cleanup failure precedence when its acquisition owner also fails', async () => {
	const { host } = fixture({ status: 'signed-out' })
	const bound = {
		...host,
		readiness: {
			...host.readiness,
			capability: {
				...host.readiness.capability,
				subscribe: () => () => {
					throw new Error('cleanup failed')
				}
			}
		}
	}
	const { owner, attach } = startup(async () => bound)
	const actor = createActor(applicationReadinessMachine, { input: attach() }).start()
	await waitFor(actor, (s) => s.matches({ active: { flow: { running: 'signedOut' } } }))
	owner.stop()
	await waitFor(actor, (s) => s.status === 'done')
	expect(selectApplicationView(actor.getSnapshot(), true)).toMatchObject({
		status: 'cleanupFailed',
		requiresReload: true
	})
	expect(host.release).toHaveBeenCalledOnce()
})
