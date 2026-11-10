import { observeBrowserConnection } from '../../offline/browser.js'
import type { ConnectionEvent } from '../../contracts/connection.js'
import { controlledSave, testLibraryCapability } from '../capture/library.test-support.js'
import {
	createSessionAcquisitionMachine,
	selectAcquiredSession
} from 'delightful-local-first/session/workflow'
import { createActor, waitFor } from 'xstate'
import { describe, expect, it, vi } from 'vitest'
import {
	createApplicationReadinessMachine,
	selectApplicationView,
	selectRecoveryBinding,
	selectLibraryActor
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
function ready(
	accountId: string,
	root: RootAccess
): Extract<AccountObservation, { status: 'ready' }> {
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
		read: async () => 'missing',
		ensure: () => ({ local: localWait, global: () => global }),
		localWait
	} satisfies RootAccess & { localWait: typeof localWait }
}

describe('account/root ownership', () => {
	it('reopens the native session before retrying a failed library bootstrap', async () => {
		const staleRead = vi.fn(async () => {
			throw new Error('Synthetic refused connection')
		})
		const freshRead = vi.fn(async () => 'compatible' as const)
		const ensure = vi.fn()
		const f = fixture(ready('bootstrap-retry', { read: staleRead, ensure }))
		const retry = vi.fn(async () => {
			f.emit(ready('bootstrap-retry', { read: freshRead, ensure }))
		})
		const actor = createActor(applicationReadinessMachine, {
			input: input({
				...f.host,
				readiness: { ...f.host.readiness, capability: { ...f.host.readiness.capability, retry } }
			})
		}).start()
		try {
			await waitFor(
				actor,
				(snapshot) => selectApplicationView(snapshot, true).status === 'rootFailed'
			)
			expect(selectApplicationView(actor.getSnapshot(), true).canRetry).toBe(true)
			actor.send({ type: 'RETRY' })
			await waitFor(actor, (snapshot) => !!selectLibraryActor(snapshot))
			expect(retry).toHaveBeenCalledOnce()
			expect(staleRead).toHaveBeenCalledOnce()
			expect(freshRead).toHaveBeenCalledOnce()
			expect(ensure).not.toHaveBeenCalled()
		} finally {
			actor.send({ type: 'SHUTDOWN' })
			await waitFor(actor, (snapshot) => snapshot.status === 'done')
			actor.stop()
		}
	})
	it('exposes recovery only for the ready library and withdraws it during shutdown', async () => {
		const reading = Promise.withResolvers<'compatible'>()
		const observation = ready('recovery-lifetime', { read: () => reading.promise, ensure: vi.fn() })
		const f = fixture(observation)
		const actor = createActor(applicationReadinessMachine, { input: input(f.host) }).start()
		try {
			await waitFor(actor, (snapshot) =>
				snapshot.matches({ active: { flow: { running: { library: 'bootstrapping' } } } })
			)
			expect(selectRecoveryBinding(actor.getSnapshot())).toBeUndefined()
			reading.resolve('compatible')
			await waitFor(actor, (snapshot) => !!selectLibraryActor(snapshot))
			expect(selectRecoveryBinding(actor.getSnapshot())?.source).toBe(observation.recovery.source)
			actor.send({ type: 'SHUTDOWN' })
			expect(selectRecoveryBinding(actor.getSnapshot())).toBeUndefined()
			await waitFor(actor, (snapshot) => snapshot.status === 'done')
		} finally {
			reading.resolve('compatible')
			actor.stop()
		}
	})

	it('waits for worker local-first preparation before reading the library root', async () => {
		const preparation = Promise.withResolvers<void>()
		const read = vi.fn(async () => 'compatible' as const)
		const observation = ready('local-first-startup', { read, ensure: vi.fn() })
		const f = fixture({ ...observation, localFirst: false })
		const prepare = vi.fn(() => preparation.promise)
		const actor = createActor(applicationReadinessMachine, {
			input: input({ ...f.host, prepare })
		}).start()
		try {
			await waitFor(actor, (snapshot) =>
				snapshot.matches({ active: { flow: { running: { preparing: 'active' } } } })
			)
			expect(prepare).toHaveBeenCalledOnce()
			expect(read).not.toHaveBeenCalled()
			f.emit({ ...observation, localFirst: true })
			expect(read).not.toHaveBeenCalled()
			preparation.resolve()
			await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
		} finally {
			preparation.resolve()
			actor.send({ type: 'SHUTDOWN' })
			await waitFor(actor, (snapshot) => snapshot.status === 'done')
			actor.stop()
		}
	})
	it('drains worker local-first preparation before acknowledging shutdown', async () => {
		const preparation = Promise.withResolvers<void>()
		const read = vi.fn(async () => 'compatible' as const)
		const f = fixture({
			...ready('local-first-drain', { read, ensure: vi.fn() }),
			localFirst: false
		})
		const actor = createActor(applicationReadinessMachine, {
			input: input({ ...f.host, prepare: () => preparation.promise })
		}).start()
		try {
			await waitFor(actor, (snapshot) =>
				snapshot.matches({ active: { flow: { running: { preparing: 'active' } } } })
			)
			actor.send({ type: 'SHUTDOWN' })
			expect(
				actor.getSnapshot().matches({ active: { flow: { running: { preparing: 'stopping' } } } })
			).toBe(true)
			expect(actor.getSnapshot().status).toBe('active')
			expect(f.host.release).not.toHaveBeenCalled()
			preparation.resolve()
			await waitFor(actor, (snapshot) => snapshot.status === 'done')
			expect(read).not.toHaveBeenCalled()
			expect(f.host.release).toHaveBeenCalledOnce()
		} finally {
			preparation.resolve()
			actor.stop()
		}
	})
	it('does not bootstrap a thin client after local-first preparation fails', async () => {
		const read = vi.fn(async () => 'compatible' as const)
		const f = fixture({
			...ready('local-first-failure', { read, ensure: vi.fn() }),
			localFirst: false
		})
		const actor = createActor(applicationReadinessMachine, {
			input: input({
				...f.host,
				prepare: async () => {
					throw new Error('Synthetic local runtime failure')
				}
			})
		}).start()
		try {
			await waitFor(actor, (snapshot) =>
				snapshot.matches({ active: { flow: { running: 'unavailable' } } })
			)
			expect(read).not.toHaveBeenCalled()
		} finally {
			actor.send({ type: 'SHUTDOWN' })
			await waitFor(actor, (snapshot) => snapshot.status === 'done')
			actor.stop()
		}
	})

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
		await waitFor(
			actor,
			(snapshot) => selectApplicationView(snapshot, true).feedback === 'restoreInvalid'
		)
		expect(actor.getSnapshot().context.phrase).toBe('')
		expect(actor.getSnapshot().matches({ active: { feedback: 'restoreInvalid' } })).toBe(true)
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
	else if (mode === 'restore')
		await waitFor(actor, (s) => selectApplicationView(s, true).feedback === 'restoreInvalid')
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

describe('application-owned browser connectivity', () => {
	it('tracks connectivity in the main snapshot across account observations and releases its observer on shutdown', async () => {
		let report: (event: ConnectionEvent) => void = () => {}
		const dispose = vi.fn()
		const observe = vi.fn((next: typeof report) => {
			report = next
			next({ type: 'OFFLINE' })
			return dispose
		})
		const f = fixture({ status: 'signed-out' })
		const { owner, attach } = startup(async () => f.host)
		const actor = createActor(createApplicationReadinessMachine<AccountHost>(observe), {
			input: attach()
		}).start()
		try {
			await waitFor(actor, (s) => s.matches({ active: { flow: { running: 'signedOut' } } }))
			expect(
				actor.getSnapshot().matches({ active: { connection: { observing: 'offline' } } })
			).toBe(true)
			expect(selectApplicationView(actor.getSnapshot(), true).connectionMessage).toEqual({
				text: 'offline',
				variant: 'info'
			})
			expect(selectApplicationView(actor.getSnapshot(), true).status).toBe('signedOut')
			report({ type: 'ONLINE' })
			expect(selectApplicationView(actor.getSnapshot(), true).connectionMessage?.text).toBe(
				'online'
			)
			f.emit({ status: 'transitioning' })
			await waitFor(actor, (s) => s.context.observation.status === 'transitioning')
			expect(observe).toHaveBeenCalledOnce()
			expect(dispose).not.toHaveBeenCalled()
			expect(actor.getSnapshot().matches({ active: { connection: { observing: 'online' } } })).toBe(
				true
			)
			actor.send({ type: 'SHUTDOWN' })
			await waitFor(actor, (s) => s.status === 'done')
			expect(dispose).toHaveBeenCalledOnce()
			report({ type: 'OFFLINE' })
			expect(selectApplicationView(actor.getSnapshot(), true).connectionMessage).toBeUndefined()
		} finally {
			actor.stop()
			owner.stop()
		}
	})

	it('releases connectivity immediately while an issued root write continues draining', async () => {
		const dispose = vi.fn()
		const pending = Promise.withResolvers<void>()
		const access = root(pending.promise, Promise.resolve())
		const f = fixture(ready('owner', access))
		const { owner, attach } = startup(async () => f.host)
		const actor = createActor(
			createApplicationReadinessMachine<AccountHost>((report) => {
				report({ type: 'ONLINE' })
				return dispose
			}),
			{ input: attach() }
		).start()
		try {
			await vi.waitFor(() => expect(access.localWait).toHaveBeenCalledOnce())
			actor.send({ type: 'SHUTDOWN' })
			expect(dispose).toHaveBeenCalledOnce()
			expect(actor.getSnapshot().matches({ active: { connection: 'closed' } })).toBe(true)
			expect(selectApplicationView(actor.getSnapshot(), true).connectionMessage).toBeUndefined()
			expect(f.host.release).not.toHaveBeenCalled()
			pending.resolve()
			await waitFor(actor, (s) => s.status === 'done')
			expect(f.host.release).toHaveBeenCalledOnce()
			expect(dispose).toHaveBeenCalledOnce()
		} finally {
			pending.resolve()
			actor.stop()
			owner.stop()
		}
	})

	it('owns the actual browser listeners and removes them on direct application stop', async () => {
		const target = new EventTarget()
		const browser = { onLine: false }
		const add = vi.spyOn(target, 'addEventListener')
		const remove = vi.spyOn(target, 'removeEventListener')
		vi.stubGlobal('window', target)
		vi.stubGlobal('navigator', browser)
		const f = fixture({ status: 'signed-out' })
		const { owner, attach } = startup(async () => f.host)
		const actor = createActor(
			createApplicationReadinessMachine<AccountHost>(observeBrowserConnection),
			{ input: attach() }
		).start()
		try {
			expect(selectApplicationView(actor.getSnapshot(), true).connectionMessage?.text).toBe(
				'offline'
			)
			browser.onLine = true
			target.dispatchEvent(new Event('online'))
			expect(selectApplicationView(actor.getSnapshot(), true).connectionMessage?.text).toBe(
				'online'
			)
			browser.onLine = false
			target.dispatchEvent(new Event('offline'))
			expect(selectApplicationView(actor.getSnapshot(), true).connectionMessage?.text).toBe(
				'offline'
			)
			expect(add.mock.calls.map((call) => call[0])).toEqual(['online', 'offline'])
			actor.stop()
			expect(remove.mock.calls.map((call) => call[0])).toEqual(['online', 'offline'])
		} finally {
			actor.stop()
			owner.stop()
			vi.unstubAllGlobals()
		}
	})
})

it('opens an existing library without reporting a new write or remote acceptance', async () => {
	const ensure = vi.fn(() => {
		throw new Error('Unexpected write')
	})
	const { host } = fixture(ready('existing', { read: async () => 'compatible', ensure }))
	const actor = createActor(applicationReadinessMachine, { input: input(host) }).start()
	await waitFor(actor, (s) =>
		s.matches({ active: { flow: { running: { library: { ready: 'existing' } } } } })
	)
	expect(selectApplicationView(actor.getSnapshot(), true)).toMatchObject({
		status: 'ready',
		message: { text: '' }
	})
	expect(ensure).not.toHaveBeenCalled()
	actor.send({ type: 'SHUTDOWN' })
	await waitFor(actor, (s) => s.status === 'done')
})

it('rejects forged private completion events while session acquisition is pending', async () => {
	const opening = Promise.withResolvers<AccountHost>()
	const session = startup(() => opening.promise)
	const rejected = vi.fn()
	const actor = createActor(applicationReadinessMachine, {
		input: session.attach(),
		onRejectedEvent: rejected
	}).start()
	const before = actor.getSnapshot()
	// Simulate an untyped external caller; the public TypeScript protocol also rejects it.
	// @ts-expect-error STARTUP_CLOSED is private coordination, not a public command.
	actor.send({ type: 'STARTUP_CLOSED' })
	expect(actor.getSnapshot()).toBe(before)
	expect(actor.getSnapshot().context.clean).toBe(false)
	expect(rejected).toHaveBeenCalledOnce()
	opening.resolve(fixture({ status: 'signed-out' }).host)
	await waitFor(actor, (snapshot) => snapshot.matches({ active: { flow: 'running' } }))
	actor.send({ type: 'SHUTDOWN' })
	await waitFor(actor, (snapshot) => snapshot.status === 'done')
	expect(actor.getSnapshot().output).toEqual({ clean: true })
	session.owner.stop()
})

it('does not apply a superseded guest preparation failure to the backend account Jazz has opened', async () => {
	const pending = Promise.withResolvers<void>()
	const access = root(Promise.resolve(), Promise.resolve())
	const guest = { ...ready('guest', access), localFirst: false }
	const backend = { ...ready('backend', access), localFirst: true, signedIn: true }
	const f = fixture(guest)
	const actor = createActor(applicationReadinessMachine, {
		input: input({ ...f.host, prepare: () => pending.promise })
	}).start()
	try {
		await waitFor(actor, (snapshot) =>
			snapshot.matches({ active: { flow: { running: 'preparing' } } })
		)
		f.emit(backend)
		await waitFor(
			actor,
			(snapshot) =>
				snapshot.context.observation.status === 'ready' &&
				snapshot.context.observation.accountId === 'backend'
		)
		pending.reject(new Error('The guest client closed during native account following'))
		await waitFor(
			actor,
			(snapshot) => snapshot.matches({ active: { flow: { running: 'library' } } }),
			{ timeout: 1000 }
		)
		expect(actor.getSnapshot().context.observation).toBe(backend)
	} finally {
		actor.stop()
	}
})

it('does not retry failed preparation just because the same account replaced its thin binding', async () => {
	const access = root(Promise.resolve(), Promise.resolve())
	const thin = { ...ready('guest', access), localFirst: false }
	const f = fixture(thin)
	let calls = 0
	const prepare = vi.fn(async () => {
		if (++calls === 1) f.emit({ ...thin, binding: {} })
		throw new Error('Local persistence unavailable')
	})
	const actor = createActor(applicationReadinessMachine, {
		input: input({ ...f.host, prepare })
	}).start()
	try {
		await waitFor(
			actor,
			(snapshot) => snapshot.matches({ active: { flow: { running: 'unavailable' } } }),
			{ timeout: 1000 }
		)
		expect(prepare).toHaveBeenCalledOnce()
	} finally {
		actor.stop()
	}
})

it('prepares a different backend account after its superseded guest preparation fails', async () => {
	const pending = Promise.withResolvers<void>()
	const access = root(Promise.resolve(), Promise.resolve())
	const guest = { ...ready('guest', access), localFirst: false }
	const backend = { ...ready('backend', access), localFirst: false, signedIn: true }
	const f = fixture(guest)
	let calls = 0
	const prepare = vi.fn(async () => {
		if (++calls === 1) return pending.promise
		f.emit({ ...backend, binding: {}, localFirst: true })
	})
	const actor = createActor(applicationReadinessMachine, {
		input: input({ ...f.host, prepare })
	}).start()
	try {
		await waitFor(actor, (s) => s.matches({ active: { flow: { running: 'preparing' } } }))
		f.emit(backend)
		await waitFor(
			actor,
			(s) =>
				s.context.observation.status === 'ready' && s.context.observation.accountId === 'backend'
		)
		pending.reject(new Error('The guest closed while Jazz opened the backend account'))
		await waitFor(actor, (s) => s.matches({ active: { flow: { running: 'library' } } }), {
			timeout: 1000
		})
		expect(prepare).toHaveBeenCalledTimes(2)
		expect(actor.getSnapshot().context.observation).toMatchObject({
			accountId: 'backend',
			localFirst: true
		})
	} finally {
		actor.stop()
	}
})

function adoptingFixture(initial: Extract<AccountObservation, { status: 'ready' }>) {
	const f = fixture(initial)
	const released: ReturnType<typeof vi.fn>[] = []
	const adopt = vi.fn((observation: Extract<AccountObservation, { status: 'ready' }>) => {
		const release = vi.fn()
		released.push(release)
		return { observation, release }
	})
	return { ...f, adopt, released, input: input({ ...f.host, adopt }) }
}
it('adopts once for unchanged native identity/preparation facts and reuses the library actor', async () => {
	const initial = {
		...ready('stable', { read: async () => 'compatible', ensure: vi.fn() }),
		clientBinding: {},
		databaseBinding: {},
		signedIn: false
	}
	const f = adoptingFixture(initial)
	const actor = createActor(applicationReadinessMachine, { input: f.input }).start()
	try {
		await waitFor(actor, (s) => !!selectLibraryActor(s))
		const library = selectLibraryActor(actor.getSnapshot())
		for (let index = 0; index < 4; index++) f.emit({ ...initial, signedIn: true })
		await vi.waitFor(() =>
			expect(actor.getSnapshot().context.observation).toMatchObject({ signedIn: true })
		)
		expect(f.adopt).toHaveBeenCalledExactlyOnceWith(initial)
		expect(selectLibraryActor(actor.getSnapshot())).toBe(library)
		expect(f.released[0]).not.toHaveBeenCalled()
		actor.send({ type: 'SHUTDOWN' })
		await waitFor(actor, (s) => s.status === 'done')
		expect(f.released[0]).toHaveBeenCalledOnce()
	} finally {
		actor.stop()
	}
})
it.each(['clientBinding', 'databaseBinding'] as const)(
	'retires a same-account %s replacement and adopts its exact new observation',
	async (field) => {
		const initial = {
			...ready('same-account', { read: async () => 'compatible', ensure: vi.fn() }),
			clientBinding: {},
			databaseBinding: {}
		}
		const f = adoptingFixture(initial),
			next = { ...initial, [field]: {} }
		const actor = createActor(applicationReadinessMachine, { input: f.input }).start()
		try {
			await waitFor(actor, (s) => !!selectLibraryActor(s))
			const previous = selectLibraryActor(actor.getSnapshot())
			f.emit(next)
			await vi.waitFor(() => expect(f.adopt).toHaveBeenCalledTimes(2))
			await waitFor(actor, (s) => !!selectLibraryActor(s))
			expect(f.adopt).toHaveBeenLastCalledWith(next)
			expect(f.released[0]).toHaveBeenCalledOnce()
			expect(selectLibraryActor(actor.getSnapshot())).not.toBe(previous)
		} finally {
			actor.stop()
		}
	}
)
it('adopts only C after A → B → C while an original A write drains, preserving its unknown result', async () => {
	const pending = Promise.withResolvers<import('../../contracts/storage.js').SaveResult>()
	const shutdown = vi.fn(),
		save = controlledSave(() => pending.promise, shutdown),
		id = crypto.randomUUID()
	const library = testLibraryCapability(
		{
			id,
			title: 'A',
			text: 'A',
			html: '<p>A</p>',
			finalUrl: 'https://example.com/',
			submittedUrl: 'https://example.com/',
			provenance: '{}',
			imagesMissing: false
		},
		{ spawnSave: (spawn, request) => spawn(save, { input: request }) }
	)
	const access: RootAccess = { read: async () => 'compatible', ensure: vi.fn() }
	const a = { ...ready('A', access), library },
		b = ready('B', access),
		c = ready('C', access)
	const f = adoptingFixture(a),
		actor = createActor(applicationReadinessMachine, { input: f.input }).start()
	try {
		await waitFor(actor, (s) => !!selectLibraryActor(s))
		const original = selectLibraryActor(actor.getSnapshot())
		if (!original) throw new Error('Missing A library')
		original.send({ type: 'ADD', url: 'https://example.com/' })
		await waitFor(original, (s) => s.matches({ running: { capture: 'saving' } }))
		f.emit(b)
		f.emit(c)
		await waitFor(
			actor,
			(s) => s.context.observation.status === 'ready' && s.context.observation.accountId === 'C'
		)
		expect(selectLibraryActor(actor.getSnapshot())).toBeUndefined()
		expect(f.adopt).toHaveBeenCalledOnce()
		expect(f.released[0]).not.toHaveBeenCalled()
		expect(shutdown).toHaveBeenCalledOnce()
		pending.resolve({ kind: 'unknown', operationId: id })
		await waitFor(actor, (s) => !!selectLibraryActor(s))
		expect(f.adopt.mock.calls.map(([observation]) => observation.accountId)).toEqual(['A', 'C'])
		expect(f.adopt).toHaveBeenLastCalledWith(c)
		expect(f.released[0]).toHaveBeenCalledOnce()
	} finally {
		pending.resolve({ kind: 'unknown', operationId: id })
		actor.stop()
	}
})
it('releases a candidate superseded during native creation before adopting the replacement', async () => {
	const access: RootAccess = { read: async () => 'compatible', ensure: vi.fn() },
		a = ready('A', access),
		b = ready('B', access)
	const f = adoptingFixture(a),
		first = f.adopt.getMockImplementation()
	if (!first) throw new Error('Missing native adoption')
	f.adopt.mockImplementation((observation) => {
		if (observation === a) f.emit(b)
		return first(observation)
	})
	const actor = createActor(applicationReadinessMachine, { input: f.input }).start()
	try {
		await waitFor(actor, (s) => !!selectLibraryActor(s))
		expect(actor.getSnapshot().context.observation).toMatchObject({ accountId: 'B' })
		expect(f.adopt.mock.calls.map(([observation]) => observation.accountId)).toEqual(['A', 'B'])
		expect(f.released[0]).toHaveBeenCalledOnce()
	} finally {
		actor.stop()
	}
})
it('forced application stop revokes the adopted native capability exactly once', async () => {
	const f = adoptingFixture(ready('stop', { read: async () => 'compatible', ensure: vi.fn() }))
	const actor = createActor(applicationReadinessMachine, { input: f.input }).start()
	await waitFor(actor, (s) => !!selectLibraryActor(s))
	actor.stop()
	actor.stop()
	expect(f.released[0]).toHaveBeenCalledOnce()
})

it('does not retry failed native binding construction from duplicate observations; explicit retry admits another attempt', async () => {
	const observation = ready('failed-binding', { read: async () => 'compatible', ensure: vi.fn() }),
		f = adoptingFixture(observation)
	f.adopt.mockImplementationOnce(() => {
		throw new Error('Native capability unavailable')
	})
	const actor = createActor(applicationReadinessMachine, { input: f.input }).start()
	try {
		await waitFor(actor, (s) => s.matches({ active: { flow: { running: 'unavailable' } } }), {
			timeout: 1000
		})
		f.emit({ ...observation })
		f.emit({ ...observation })
		expect(f.adopt).toHaveBeenCalledOnce()
		actor.send({ type: 'RETRY' })
		await waitFor(actor, (s) => !!selectLibraryActor(s), { timeout: 1000 })
		expect(f.adopt).toHaveBeenCalledTimes(2)
	} finally {
		actor.stop()
	}
})
it('shutdown during native candidate construction releases that candidate once and never publishes it', async () => {
	const observation = ready('shutdown-candidate', {
			read: vi.fn(async (): Promise<'compatible'> => 'compatible'),
			ensure: vi.fn()
		}),
		f = adoptingFixture(observation)
	const construct = f.adopt.getMockImplementation()
	if (!construct) throw new Error('Missing native construction')
	const actor = createActor(applicationReadinessMachine, { input: f.input })
	f.adopt.mockImplementation((candidate) => {
		actor.send({ type: 'SHUTDOWN' })
		return construct(candidate)
	})
	actor.start()
	try {
		await waitFor(actor, (s) => s.status === 'done', { timeout: 1000 })
		expect(selectLibraryActor(actor.getSnapshot())).toBeUndefined()
		expect(observation.root.read).not.toHaveBeenCalled()
		expect(f.released[0]).toHaveBeenCalledOnce()
	} finally {
		actor.stop()
	}
})
